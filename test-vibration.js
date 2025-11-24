const fetch = require('node-fetch');

async function testVibrationSensor() {
  try {
    const response = await fetch('http://localhost:3000/api/sensors/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sensorType: 'vibration'
      })
    });
    
    const result = await response.json();
    console.log('Test result:', result);
  } catch (error) {
    console.error('Error:', error);
  }
}

testVibrationSensor();