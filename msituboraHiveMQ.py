import network
import socket
from time import time, sleep
import machine
from umqtt.simple import MQTTClient
import random
import ahtx0
from machine import Pin, I2C
from lcd_api import LcdApi
from pico_i2c_lcd import I2cLcd
import math
import ssl

import wificonnect
print("Connected to Wifi.")

wlan = network.WLAN(network.STA_IF)

i2c = I2C(1, scl=Pin(15), sda=Pin(14))
sensor = ahtx0.AHT10(i2c)

temp_data = sensor.temperature
hum_data = sensor.relative_humidity

vibration = Pin(0, Pin.IN, Pin.PULL_DOWN)
fire = Pin(1, Pin.IN, Pin.PULL_DOWN)
smoke = Pin(2, Pin.IN, Pin.PULL_DOWN)
led = Pin("LED", Pin.OUT)
led.value(0)

# ---- USER SETTINGS ----

MQTT_BROKER = "654455528da74c608a1c57446238b9ed.s1.eu.hivemq.cloud"   # or your HiveMQ Cloud URL
MQTT_PORT = 0                    # 8883 for SSL
MQTT_CLIENT_ID = "Pico"
MQTT_USER = "MsituBora"
MQTT_PASSWORD = "MsituBora2025"
temperature_topic = "temp"
humidity_topic = "hum"
vibration_topic = 'vibration'
smoke_topic = 'smoke'
fire_topic = 'fire'

context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
context.verify_mode = ssl.CERT_NONE

def mqtt_connect():
    client = MQTTClient(client_id=MQTT_CLIENT_ID, server=MQTT_BROKER, port=MQTT_PORT, user=MQTT_USER, password=MQTT_PASSWORD, ssl=context, keepalive=3600)
    client.connect()
    print('Connected to %s MQTT Broker'%(MQTT_BROKER))
    return client

def reconnect():
    print('Failed to connect to the MQTT Broker. Reconnecting...')
    time.sleep(5)
    reset()

try:
    client = mqtt_connect()
except OSError as e:
    reconnect()

def temp_hum_function():
    temp_data = sensor.temperature
    hum_data = sensor.relative_humidity
    formatted_temp = round(temp_data, 1)
    formatted_hum = round(hum_data)
    client.publish(temperature_topic, str(temp_data) ) #MQTT Works with strings therefore convert the temp data into string
    client.publish(humidity_topic, str(hum_data) ) #MQTT Works with strings therefore convert the temp data into string
    print(" Sent temperature is "+ str(temp_data) )
    print(" Sent humidity is "+ str(hum_data) )
    sleep(2)

def event():
    if not vibration.value():
        led.value(1)
        client.publish(vibration_topic, "1" )
        
    if not fire.value():
        led.value(1)
        client.publish(fire_topic, "1" )
    
    if not smoke.value():
        led.value(1)
        client.publish(smoke_topic, "1")

    sleep(15)

while True:
    if wlan.isconnected():
        try:
            if not vibration.value() or not fire.value() or not smoke.value():
                print("Occurrence detected")
                temp_hum_function()
                event()
                
            else:
                print("No event detected")
                led.value(0)
                client.publish(vibration_topic, "0")
                client.publish(fire_topic, "0")
                client.publish(smoke_topic, "0")
                sleep(5)
        
        except Exception as e:
            print(e) 
        
    else:
        reconnect()
        sleep(1)