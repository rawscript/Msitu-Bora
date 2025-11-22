// ============================================================
// MSITU BORA - KAKAMEGA FOREST MONITORING BACKEND
// ============================================================
// Raspberry Pi Pico W → MQTT → Backend → Supabase + Blockchain
// Sensor Data: Temperature, Humidity, Vibration, Smoke, Fire
// ============================================================

require('dotenv').config();
const mqtt = require('mqtt');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { ethers } = require('ethers');
const axios = require('axios');
const crypto = require('crypto');

// ============== CONFIGURATION ==============
const config = {
    mqtt: {
        broker: process.env.MQTT_BROKER || 'your-cluster.hivemq.cloud',
        port: parseInt(process.env.MQTT_PORT) || 0,
        username: process.env.MQTT_USERNAME,
        password: process.env.MQTT_PASSWORD,
        topics: ['topic/temp', 'topic/hum', 'topic/vibration', 'topic/smoke', 'topic/fire'] // Sensor data topics
    },
    
    supabase: {
        url: process.env.SUPABASE_URL,
        key: process.env.SUPABASE_ANON_KEY
    },
    
    blockchain: {
        rpc: process.env.BLOCKCHAIN_RPC || 'https://rpc-amoy.polygon.technology',
        contractAddress: process.env.CONTRACT_ADDRESS,
        privateKey: process.env.PRIVATE_KEY,
        enabled: process.env.BLOCKCHAIN_ENABLED === 'true',
        chainId: 80002
    },
    
    telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        chatId: process.env.TELEGRAM_CHAT_ID,
        enabled: process.env.TELEGRAM_ENABLED === 'true'
    },
    
    africastalking: {
        apiKey: process.env.AT_API_KEY,
        username: process.env.AT_USERNAME || 'sandbox',
        phoneNumber: process.env.AT_PHONE_NUMBER,
        enabled: process.env.SMS_ENABLED === 'true'
    },
    
    server: {
        port: process.env.PORT || 3000
    }
};

// ============== VALIDATE CONFIGURATION ==============
function validateConfig() {
    const required = {
        'MQTT_BROKER': config.mqtt.broker,
        'MQTT_USERNAME': config.mqtt.username,
        'MQTT_PASSWORD': config.mqtt.password,
        'SUPABASE_URL': config.supabase.url,
        'SUPABASE_ANON_KEY': config.supabase.key
    };
    
    const missing = Object.entries(required)
        .filter(([key, value]) => !value || value.includes('your'))
        .map(([key]) => key);
    
    if (missing.length > 0) {
        console.error('\n❌ CONFIGURATION ERROR: Missing required environment variables:');
        missing.forEach(key => console.error(`   - ${key}`));
        console.error('\n💡 Update your .env file\n');
        process.exit(1);
    }
}

validateConfig();

// ============== SMART CONTRACT ABI ==============
const contractABI = [
    "function logAlert(string memory alertHash, uint256 timestamp) public",
    "function getAlert(string memory alertHash) public view returns (uint256)",
    "function getTotalAlerts() public view returns (uint256)"
];

// ============== INITIALIZE SERVICES ==============

console.log('\n' + '='.repeat(60));
console.log(' MSITU BORA - KAKAMEGA FOREST MONITORING SYSTEM');
console.log('='.repeat(60) + '\n');

// Supabase
let supabase;
try {
    supabase = createClient(config.supabase.url, config.supabase.key);
    console.log(' Supabase initialized');
} catch (error) {
    console.error(' Supabase error:', error.message);
    process.exit(1);
}

// Blockchain
let blockchainProvider = null;
let wallet = null;
let contract = null;

if (config.blockchain.enabled && config.blockchain.privateKey && config.blockchain.contractAddress) {
    try {
        blockchainProvider = new ethers.JsonRpcProvider(config.blockchain.rpc);
        wallet = new ethers.Wallet(config.blockchain.privateKey, blockchainProvider);
        contract = new ethers.Contract(config.blockchain.contractAddress, contractABI, wallet);
        console.log(' Blockchain initialized (Polygon Amoy)');
        console.log(`   Wallet: ${wallet.address}`);
    } catch (error) {
        console.warn('  Blockchain disabled:', error.message);
        config.blockchain.enabled = false;
    }
} else {
    console.log('  Blockchain disabled');
}

// Express
const app = express();
app.use(express.json());
app.use(express.static('public'));

// ============== MQTT SETUP ==============

const mqttOptions = {
    host: config.mqtt.broker,
    port: config.mqtt.port > 0 ? config.mqtt.port : 8883, // Use 8883 as default for SSL
    protocol: config.mqtt.port === 0 ? 'mqtts' : (config.mqtt.port === 8883 ? 'mqtts' : 'mqtt'),
    username: config.mqtt.username,
    password: config.mqtt.password,
    clientId: process.env.MQTT_CLIENT_ID || 'MsituBoraBackend',
    keepalive: 60,
    reconnectPeriod: 5000,
    clean: true
};

console.log('🔌 Connecting to HiveMQ MQTT Broker...');
const mqttClient = mqtt.connect(mqttOptions);

let eventCount = 0;
let hubStatuses = new Map(); // Track hub health

// ============== MQTT EVENT HANDLERS ==============

mqttClient.on('connect', () => {
    console.log(' Connected to MQTT Broker');
    
    config.mqtt.topics.forEach(topic => {
        mqttClient.subscribe(topic, { qos: 1 }, (err) => {
            if (err) {
                console.error(` Subscribe failed: ${topic}`);
            } else {
                console.log(` Subscribed: ${topic}`);
            }
        });
    });
    
    console.log('\n' + '='.repeat(60));
    console.log(' SYSTEM READY - Monitoring Kakamega Forest');
    console.log('='.repeat(60) + '\n');
    console.log(' Listening for sensor data on topics:');
    config.mqtt.topics.forEach(topic => console.log(`  - ${topic}`));
    console.log();
});

mqttClient.on('error', (error) => {
    console.error(' MQTT Error:', error.message);
});

mqttClient.on('reconnect', () => {
    console.log(' Reconnecting to MQTT...');
});

// ============== MAIN ALERT PROCESSING ==============

mqttClient.on('message', async (topic, message) => {
    try {
        eventCount++;
        
        // Handle sensor data topics
        if (topic === 'topic/temp' || topic === 'topic/hum' || topic === 'topic/vibration' || 
            topic === 'topic/smoke' || topic === 'topic/fire') {
            await processSensorData(topic, message.toString());
            return;
        }
        
        // Handle legacy alert format
        const event = JSON.parse(message.toString());
        
        // Determine if this is a hub status update or alert
        if (topic.includes('/status') || event.type === 'heartbeat') {
            await processHubStatus(event);
            return;
        }
        
        // Process forest alert
        await processForestAlert(event, topic);
        
    } catch (error) {
        console.error(' Message processing error:', error.message);
        console.error('Raw:', message.toString().substring(0, 200));
    }
});

// ============== PROCESS HUB STATUS ==============

async function processHubStatus(status) {
    try {
        hubStatuses.set(status.hubId, {
            ...status,
            lastSeen: new Date().toISOString()
        });
        
        // Update hub in database
        const { error } = await supabase
            .from('forest_hubs')
            .upsert({
                hub_id: status.hubId,
                battery_level: status.battery,
                signal_rssi: status.rssi,
                status: 'online',
                last_seen: new Date().toISOString()
            }, { onConflict: 'hub_id' });
        
        if (error) throw error;
        
    } catch (error) {
        console.error('Hub status error:', error.message);
    }
}

// ============== PROCESS FOREST ALERT ==============

async function processForestAlert(event, topic) {
    const startTime = Date.now();
    
    console.log('\n' + '='.repeat(60));
    console.log(` FOREST EVENT #${eventCount}`);
    console.log('='.repeat(60));
    console.log(` Hub: ${event.hubId || 'Unknown'}`);
    console.log(` Type: ${event.eventType || 'Unknown'}`);
    console.log(`  Severity: ${(event.severity || 'medium').toUpperCase()}`);
    
    if (event.coordinates) {
        console.log(` Location: ${event.coordinates.lat}, ${event.coordinates.lng}`);
    }
    
    if (event.mlConfidence) {
        console.log(` ML Confidence: ${event.mlConfidence}%`);
    }
    
    try {
        // Normalize event format
        const alert = normalizeForestEvent(event, topic);
        
        // Create hash
        const alertHash = createEventHash(alert);
        alert.hash = alertHash;
        console.log(` Hash: ${alertHash.substring(0, 16)}...`);
        
        // Store in Supabase
        console.log(' Storing in Supabase...');
        const supabaseResult = await storeForestAlert(alert);
        console.log(` Stored (ID: ${supabaseResult.id})`);
        
        // Log to blockchain (async)
        if (config.blockchain.enabled && contract) {
            console.log('⛓️  Logging to blockchain...');
            logToBlockchain(alertHash, alert, supabaseResult.id)
                .then(receipt => {
                    if (receipt) {
                        console.log(` Blockchain confirmed (Block: ${receipt.blockNumber})`);
                    }
                })
                .catch(err => console.error(' Blockchain error:', err.message));
        }
        
        // Send notifications for critical events
        if (['critical', 'high'].includes(alert.severity.toLowerCase())) {
            console.log('📱 Sending notifications...');
            sendNotifications(alert)
                .then(() => console.log(' Notifications sent'))
                .catch(err => console.error(' Notification error:', err.message));
        }
        
        const processingTime = Date.now() - startTime;
        console.log(`  Processing: ${processingTime}ms`);
        console.log('='.repeat(60) + '\n');
        
    } catch (error) {
        console.error(' Processing failed:', error.message);
    }
}

// ============== PROCESS SENSOR DATA ==============
async function processSensorData(topic, message) {
    const startTime = Date.now();
    
    console.log('\n' + '='.repeat(60));
    console.log(` SENSOR DATA #${eventCount}`);
    console.log('='.repeat(60));
    
    try {
        // Parse sensor data
        let sensorValue;
        try {
            sensorValue = JSON.parse(message);
        } catch {
            // If not JSON, treat as plain value
            sensorValue = message;
        }
        
        console.log(` Topic: ${topic}`);
        console.log(` Value: ${typeof sensorValue === 'object' ? JSON.stringify(sensorValue) : sensorValue}`);
        
        // Extract sensor type from topic
        const sensorType = topic.replace('topic/', '');
        
        // Create sensor reading record
        const sensorReading = {
            sensor_type: sensorType,
            value: typeof sensorValue === 'object' ? sensorValue.value || sensorValue.data || JSON.stringify(sensorValue) : sensorValue,
            raw_message: typeof sensorValue === 'object' ? JSON.stringify(sensorValue) : sensorValue,
            timestamp: new Date().toISOString(),
            received_at: new Date().toISOString()
        };
        
        // Store in Supabase
        console.log(' Storing in Supabase...');
        const supabaseResult = await storeSensorReading(sensorReading);
        console.log(`✅ Supabase storage successful (ID: ${supabaseResult.id})`);
        
        // Check for alert conditions
        console.log(' Checking for alert conditions...');
        await checkSensorAlerts(sensorReading);
        console.log('✅ Alert checking completed');
        
        const processingTime = Date.now() - startTime;
        console.log(`  Processing time: ${processingTime}ms`);
        console.log('='.repeat(60) + '\n');
        
    } catch (error) {
        console.error('❌ Sensor data processing failed:', error.message);
        console.error('Raw message:', message.toString().substring(0, 200));
    }
}

// ============== STORE SENSOR READING ==============
async function storeSensorReading(reading) {
    try {
        console.log(`💾 Storing sensor reading: ${reading.sensor_type} = ${reading.value}`);
        
        const readingRecord = {
            sensor_type: reading.sensor_type,
            value: reading.value,
            raw_message: reading.raw_message,
            timestamp: reading.timestamp,
            received_at: reading.received_at
        };
        
        const { data, error } = await supabase
            .from('sensor_readings')
            .insert([readingRecord])
            .select()
            .single();
        
        if (error) throw error;
        
        console.log(`✅ Sensor reading stored successfully (ID: ${data.id})`);
        return data;
        
    } catch (error) {
        console.error('❌ Supabase sensor reading error:', error.message);
        throw error;
    }
}

// ============== NORMALIZE EVENT FORMAT ==============

function normalizeForestEvent(event, topic) {
    return {
        hubId: event.hubId || event.hub_id || 'UNKNOWN',
        eventType: event.eventType || event.event_type || event.type || 'unknown',
        severity: event.severity || 'medium',
        coordinates: event.coordinates || {
            lat: event.latitude || event.lat || null,
            lng: event.longitude || event.lng || null
        },
        sensorData: event.sensorData || event.sensor_data || {},
        mlConfidence: event.mlConfidence || event.ml_confidence || null,
        battery: event.battery || event.battery_level || null,
        rssi: event.rssi || event.signal_rssi || null,
        detectedAt: event.timestamp || event.detected_at || new Date().toISOString(),
        receivedAt: new Date().toISOString(),
        topic: topic,
        message: event.message || event.event_message || `${event.eventType} detected`
    };
}

// ============== SUPABASE OPERATIONS ==============

async function storeForestAlert(alert) {
    try {
        // Prepare coordinates for PostGIS
        let coordinates = null;
        if (alert.coordinates && alert.coordinates.lat && alert.coordinates.lng) {
            coordinates = `POINT(${alert.coordinates.lng} ${alert.coordinates.lat})`;
        }
        
        const alertRecord = {
            hub_id: alert.hubId,
            event_type: alert.eventType,
            severity: alert.severity,
            latitude: alert.coordinates?.lat || null,
            longitude: alert.coordinates?.lng || null,
            coordinates: coordinates,
            event_message: alert.message,
            sensor_data: alert.sensorData,
            ml_confidence: alert.mlConfidence,
            battery_level: alert.battery,
            signal_rssi: alert.rssi,
            detected_at: alert.detectedAt,
            received_at: alert.receivedAt,
            blockchain_hash: alert.hash,
            blockchain_tx: null,
            blockchain_confirmed: false
        };
        
        const { data, error } = await supabase
            .from('forest_alerts')
            .insert([alertRecord])
            .select()
            .single();
        
        if (error) throw error;
        
        return data;
        
    } catch (error) {
        console.error(' Supabase error:', error.message);
        throw error;
    }
}

async function checkSensorAlerts(reading) {
    try {
        // Define threshold values for alerts
        const thresholds = {
            temp: { max: 40, min: -10 }, // Temperature in Celsius
            hum: { max: 90, min: 10 },   // Humidity in percentage
            vibration: { max: 100 },     // Vibration intensity
            smoke: { max: 200 },         // Smoke concentration
            fire: { max: 1 }             // Fire detection (binary)
        };
        
        const sensorType = reading.sensor_type;
        const value = parseFloat(reading.value);
        
        // Skip if value is not a number or sensor type has no thresholds
        if (isNaN(value) || !thresholds[sensorType]) {
            return;
        }
        
        const threshold = thresholds[sensorType];
        let alertTriggered = false;
        let alertMessage = '';
        let severity = 'medium';
        
        // Special handling for binary sensors (smoke, fire)
        if (sensorType === 'smoke' || sensorType === 'fire') {
            // For binary sensors, any detection above threshold triggers an alert
            if (value >= threshold.max) {
                alertTriggered = true;
                alertMessage = sensorType === 'smoke' ? 'Smoke detected' : 'Fire detected';
                severity = sensorType === 'fire' ? 'critical' : 'high';
            }
        } else {
            // For continuous sensors (temp, hum, vibration), check thresholds
            if (threshold.max !== undefined && value > threshold.max) {
                alertTriggered = true;
                alertMessage = `${sensorType.toUpperCase()} reading (${value}) exceeded maximum threshold (${threshold.max})`;
                // Set severity based on how much the threshold is exceeded
                severity = value > threshold.max * 1.5 ? 'critical' : 'high';
            } else if (threshold.min !== undefined && value < threshold.min) {
                alertTriggered = true;
                alertMessage = `${sensorType.toUpperCase()} reading (${value}) below minimum threshold (${threshold.min})`;
                // Set severity based on how much the threshold is exceeded
                severity = value < threshold.min * 1.5 ? 'critical' : 'high';
            }
        }
        
        // If alert triggered, create a forest alert
        if (alertTriggered) {
            const alertEvent = {
                hubId: 'SENSOR_NETWORK',
                eventType: sensorType,
                severity: severity,
                message: alertMessage,
                sensorData: { [sensorType]: value },
                timestamp: reading.timestamp
            };
            
            console.log(`⚠️  Sensor Alert: ${alertMessage}`);
            await processForestAlert(alertEvent, `topic/${sensorType}/alert`);
        }
        
    } catch (error) {
        console.error(' Sensor alert checking failed:', error.message);
    }
}

async function updateBlockchainTx(alertId, txHash, blockNumber) {
    try {
        const { error } = await supabase
            .from('forest_alerts')
            .update({ 
                blockchain_tx: txHash,
                blockchain_confirmed: true,
                blockchain_block: blockNumber
            })
            .eq('id', alertId);
        
        if (error) throw error;
        
    } catch (error) {
        console.error(' Update blockchain tx failed:', error.message);
    }
}

// ============== BLOCKCHAIN OPERATIONS ==============

async function logToBlockchain(alertHash, alert, supabaseId) {
    if (!contract) return null;
    
    try {
        const timestamp = Math.floor(Date.parse(alert.receivedAt) / 1000);
        
        const tx = await contract.logAlert(alertHash, timestamp, {
            gasLimit: 200000
        });
        
        console.log(`    TX: ${tx.hash}`);
        
        const receipt = await tx.wait();
        console.log(`    Block: ${receipt.blockNumber}`);
        
        await updateBlockchainTx(supabaseId, tx.hash, receipt.blockNumber);
        
        return receipt;
        
    } catch (error) {
        console.error('    Blockchain failed:', error.message);
        
        try {
            await supabase
                .from('forest_alerts')
                .update({ 
                    blockchain_error: error.message,
                    blockchain_confirmed: false
                })
                .eq('id', supabaseId);
        } catch {}
        
        return null;
    }
}

// ============== NOTIFICATIONS ==============

async function sendNotifications(alert) {
    const message = formatForestAlert(alert);
    const promises = [];
    
    if (config.telegram.enabled && config.telegram.botToken) {
        promises.push(sendTelegram(message));
    }
    
    if (config.africastalking.enabled && alert.severity === 'critical') {
        promises.push(sendSMS(message));
    }
    
    await Promise.allSettled(promises);
}

async function sendTelegram(message) {
    try {
        const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
        await axios.post(url, {
            chat_id: config.telegram.chatId,
            text: message,
            parse_mode: 'Markdown'
        });
        console.log('    Telegram sent');
    } catch (error) {
        console.error('    Telegram failed:', error.response?.data?.description || error.message);
    }
}

async function sendSMS(message) {
    try {
        const AfricasTalking = require('africastalking');
        const africastalking = AfricasTalking({
            apiKey: config.africastalking.apiKey,
            username: config.africastalking.username
        });
        
        const sms = africastalking.SMS;
        const result = await sms.send({
            to: [config.africastalking.phoneNumber],
            message: message.substring(0, 160)
        });
        
        console.log('    SMS sent');
    } catch (error) {
        console.error('    SMS failed:', error.message);
    }
}

// ============== HELPER FUNCTIONS ==============

function createEventHash(alert) {
    const data = JSON.stringify({
        hubId: alert.hubId,
        eventType: alert.eventType,
        coordinates: alert.coordinates,
        timestamp: alert.detectedAt,
        severity: alert.severity
    });
    return crypto.createHash('sha256').update(data).digest('hex');
}

function formatForestAlert(alert) {
    const emoji = {
        fire: '',
        chainsaw: '',
        'tree-fall': '',
        smoke: '',
        system: ''
    };
    
    const severityEmoji = {
        critical: '🔴',
        high: '🟠',
        medium: '🟡',
        low: '🟢'
    };
    
    let msg = `${emoji[alert.eventType] || ''} *KAKAMEGA FOREST ALERT*\n\n`;
    msg += `*Type:* ${alert.eventType.toUpperCase()}\n`;
    msg += `${severityEmoji[alert.severity]} *Severity:* ${alert.severity.toUpperCase()}\n`;
    msg += `*Hub:* ${alert.hubId}\n`;
    
    if (alert.coordinates?.lat && alert.coordinates?.lng) {
        msg += `*Location:* ${alert.coordinates.lat.toFixed(4)}, ${alert.coordinates.lng.toFixed(4)}\n`;
    }
    
    if (alert.mlConfidence) {
        msg += `*Confidence:* ${alert.mlConfidence}%\n`;
    }
    
    msg += `*Time:* ${new Date(alert.detectedAt).toLocaleString()}\n`;
    
    return msg;
}

// ============== REST API ==============

app.get('/health', async (req, res) => {
    let blockchainStatus = 'disabled';
    if (config.blockchain.enabled && blockchainProvider) {
        try {
            await blockchainProvider.getBlockNumber();
            blockchainStatus = 'connected';
        } catch {
            blockchainStatus = 'error';
        }
    }
    
    // Get sensor readings count
    let sensorReadingsCount = 0;
    try {
        const { count, error } = await supabase
            .from('sensor_readings')
            .select('*', { count: 'exact', head: true });
        if (!error) sensorReadingsCount = count;
    } catch (error) {
        console.error('Failed to get sensor readings count:', error.message);
    }
    
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
            mqtt: mqttClient.connected,
            supabase: true,
            blockchain: blockchainStatus
        },
        stats: {
            eventsProcessed: eventCount,
            activeHubs: hubStatuses.size,
            sensorReadings: sensorReadingsCount
        }
    });
});

app.get('/api/events', async (req, res) => {
    try {
        console.log('📡 API: Fetching forest events...');
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        
        const { data, error } = await supabase
            .from('forest_alerts')
            .select('*')
            .order('detected_at', { ascending: false })
            .limit(limit);
        
        if (error) throw error;
        
        console.log(`✅ API: Returning ${data.length} forest events`);
        res.json({ success: true, count: data.length, events: data });
    } catch (error) {
        console.error('❌ API: Forest events error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/events/recent', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        
        const { data, error } = await supabase
            .from('forest_alerts')
            .select('*')
            .order('detected_at', { ascending: false })
            .limit(limit);
        
        if (error) throw error;
        
        res.json({ success: true, count: data.length, events: data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/hubs', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('forest_hubs')
            .select('*')
            .order('hub_id');
        
        if (error) throw error;
        
        res.json({ success: true, count: data.length, hubs: data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/stats', async (req, res) => {
    try {
        const { count: totalEvents } = await supabase
            .from('forest_alerts')
            .select('*', { count: 'exact', head: true });
        
        const { data: eventTypes } = await supabase
            .from('forest_alerts')
            .select('event_type');
        
        const typeCounts = eventTypes.reduce((acc, item) => {
            acc[item.event_type] = (acc[item.event_type] || 0) + 1;
            return acc;
        }, {});
        
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count: last24h } = await supabase
            .from('forest_alerts')
            .select('*', { count: 'exact', head: true })
            .gte('detected_at', yesterday);
        
        // Get sensor data stats
        const { count: totalSensorReadings } = await supabase
            .from('sensor_readings')
            .select('*', { count: 'exact', head: true });
        
        const { data: sensorTypes } = await supabase
            .from('sensor_readings')
            .select('sensor_type');
        
        const sensorTypeCounts = sensorTypes.reduce((acc, item) => {
            acc[item.sensor_type] = (acc[item.sensor_type] || 0) + 1;
            return acc;
        }, {});
        
        const { count: recentSensorReadings } = await supabase
            .from('sensor_readings')
            .select('*', { count: 'exact', head: true })
            .gte('timestamp', yesterday);
        
        res.json({
            total: totalEvents,
            last24Hours: last24h,
            byType: typeCounts,
            processedThisSession: eventCount,
            sensors: {
                total: totalSensorReadings,
                last24Hours: recentSensorReadings,
                byType: sensorTypeCounts
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/events/test', async (req, res) => {
    try {
        const testEvent = {
            hubId: req.body.hubId || 'KAK-TEST',
            eventType: req.body.eventType || 'system',
            severity: req.body.severity || 'medium',
            coordinates: req.body.coordinates || { lat: 0.35, lng: 34.85 },
            timestamp: new Date().toISOString(),
            message: 'Test event from API'
        };
        
        mqttClient.publish('kakamega/test', JSON.stringify(testEvent), { qos: 1 });
        
        res.json({ success: true, message: 'Test event published', event: testEvent });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/sensors/recent', async (req, res) => {
    try {
        console.log('📡 API: Fetching recent sensor readings...');
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        
        const { data, error } = await supabase
            .from('sensor_readings')
            .select('*')
            .order('timestamp', { ascending: false })
            .limit(limit);
        
        if (error) throw error;
        
        console.log(`✅ API: Returning ${data.length} sensor readings`);
        res.json({ success: true, count: data.length, readings: data });
    } catch (error) {
        console.error('❌ API: Sensor readings error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/sensors/:type', async (req, res) => {
    try {
        const sensorType = req.params.type;
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        
        const { data, error } = await supabase
            .from('sensor_readings')
            .select('*')
            .eq('sensor_type', sensorType)
            .order('timestamp', { ascending: false })
            .limit(limit);
        
        if (error) throw error;
        
        res.json({ success: true, count: data.length, readings: data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/sensors/test', async (req, res) => {
    try {
        const sensorTypes = ['temp', 'hum', 'vibration', 'smoke', 'fire'];
        const sensorType = req.body.sensorType || sensorTypes[Math.floor(Math.random() * sensorTypes.length)];
        
        // Generate random sensor value based on type
        let value;
        switch (sensorType) {
            case 'temp':
                value = (Math.random() * 50 - 10).toFixed(2); // -10 to 40
                break;
            case 'hum':
                value = (Math.random() * 100).toFixed(2); // 0 to 100
                break;
            case 'vibration':
                value = (Math.random() * 150).toFixed(2); // 0 to 150
                break;
            case 'smoke':
                value = (Math.random() * 300).toFixed(2); // 0 to 300
                break;
            case 'fire':
                value = Math.random() > 0.9 ? 1 : 0; // 10% chance of fire detection
                break;
            default:
                value = Math.random().toFixed(2);
        }
        
        const testReading = {
            sensor_type: sensorType,
            value: value,
            raw_message: value,
            timestamp: new Date().toISOString(),
            received_at: new Date().toISOString()
        };
        
        // Store in database
        const result = await storeSensorReading(testReading);
        
        res.json({ success: true, message: 'Test sensor reading stored', reading: testReading, id: result.id });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/', (req, res) => {
    res.redirect('/index.html');
});

// Antugrow authentication endpoint
app.get('/api/antugrow-auth', (req, res) => {
    // In a production environment, you would implement proper authentication
    // For now, we're providing the API key from environment variables
    res.json({
        apiKey: config.africastalking.apiKey || process.env.AT_API_KEY,
        accessToken: null
    });
});

// ============== START SERVER ==============

const server = app.listen(config.server.port, () => {
    console.log('\n' + '='.repeat(60));
    console.log(' WEB SERVER STARTED');
    console.log('='.repeat(60));
    console.log(` Dashboard: http://localhost:${config.server.port}`);
    console.log(` Health: http://localhost:${config.server.port}/health`);
    console.log(` Stats: http://localhost:${config.server.port}/api/stats`);
    console.log(` Sensor Readings: http://localhost:${config.server.port}/api/sensors/recent`);
    console.log('='.repeat(60) + '\n');
});

// ============== GRACEFUL SHUTDOWN ==============

function shutdown(signal) {
    console.log(`\n${signal} received. Shutting down...`);
    
    if (mqttClient.connected) {
        mqttClient.end();
    }
    
    server.close(() => {
        console.log(' Server closed');
    });
    
    console.log('\n Goodbye!\n');
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
    console.error('\n Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason) => {
    console.error('\n Unhandled Rejection:', reason);
});