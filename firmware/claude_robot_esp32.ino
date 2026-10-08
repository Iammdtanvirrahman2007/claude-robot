/*
  Claude Robot ESP32 firmware
  --------------------------------
  Real transport for the claude-robot laptop UI.

  Features:
    - Wi-Fi connection
    - UDP discovery on port 4210
    - TCP robot protocol on port 5000
    - Hardware description sent after "hello"
    - Periodic telemetry
    - Manual movement commands
    - Front ultrasonic distance sensor

  Edit the CONFIG section before uploading.
  No external Arduino library is required.
*/

#include <WiFi.h>
#include <WiFiUdp.h>

// ========================= CONFIG =========================

const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

const char* ROBOT_ID = "R4";
const char* ROBOT_NAME = "TanvirBot";
const char* ROBOT_TYPE = "wheeled";

static constexpr uint16_t DISCOVERY_PORT = 4210;
static constexpr uint16_t TCP_PORT = 5000;

// Ultrasonic sensor
static constexpr int TRIG_PIN = 5;
static constexpr int ECHO_PIN = 18;

// Optional motor pins.
// Set to -1 to disable that output until you wire your driver.
static constexpr int LEFT_MOTOR_PIN = 25;
static constexpr int RIGHT_MOTOR_PIN = 26;

// ==========================================================

WiFiUDP discoveryUdp;
WiFiServer tcpServer(TCP_PORT);
WiFiClient tcpClient;

String rxLine;
unsigned long lastTelemetry = 0;
unsigned long lastWifiCheck = 0;

int leftMotor = 0;
int rightMotor = 0;
String currentCommand = "IDLE";
float frontDistance = 120.0f;

void sendJson(const String& json) {
  if (tcpClient && tcpClient.connected()) {
    tcpClient.print(json);
    tcpClient.print('\n');
  }
}

void sendLog(const String& level, const String& text) {
  String safe = text;
  safe.replace("\\", "\\\\");
  safe.replace("\"", "\\\"");
  sendJson(
    "{\"type\":\"log\",\"line\":{\"t\":\"ESP\",\"level\":\"" +
    level + "\",\"text\":\"" + safe + "\"}}"
  );
}

void setMotorOutputs(int left, int right) {
  leftMotor = constrain(left, -100, 100);
  rightMotor = constrain(right, -100, 100);

  // Transport-level reference implementation.
  // Replace these two lines with your motor-driver code.
  if (LEFT_MOTOR_PIN >= 0) {
    analogWrite(LEFT_MOTOR_PIN, abs(leftMotor) * 255 / 100);
  }
  if (RIGHT_MOTOR_PIN >= 0) {
    analogWrite(RIGHT_MOTOR_PIN, abs(rightMotor) * 255 / 100);
  }
}

float readFrontDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 30000UL);
  if (duration == 0) return 120.0f;

  float cm = duration * 0.0343f / 2.0f;
  return constrain(cm, 2.0f, 400.0f);
}

float readBatteryPercent() {
  // Placeholder until a voltage divider / fuel gauge is wired.
  return 100.0f;
}

void sendHardware() {
  sendJson(
    "{\"type\":\"hardware\",\"robot\":{" 
    "\"id\":\"" + String(ROBOT_ID) + "\","
    "\"name\":\"" + String(ROBOT_NAME) + "\","
    "\"type\":\"" + String(ROBOT_TYPE) + "\","
    "\"ip\":\"" + WiFi.localIP().toString() + "\","
    "\"port\":" + String(TCP_PORT) + ","
    "\"sensors\":["
      "{\"id\":\"front_distance\",\"name\":\"Front Distance\",\"type\":\"distance\",\"unit\":\"cm\",\"min\":2,\"max\":400},"
      "{\"id\":\"battery\",\"name\":\"Battery\",\"type\":\"battery\",\"unit\":\"%\",\"min\":0,\"max\":100}"
    "],"
    "\"actuators\":["
      "{\"id\":\"left_motor\",\"name\":\"Left Motor\",\"type\":\"motor\",\"unit\":\"%\",\"v\":0},"
      "{\"id\":\"right_motor\",\"name\":\"Right Motor\",\"type\":\"motor\",\"unit\":\"%\",\"v\":0}"
    "]"
    "}}"
  );
}

void sendTelemetry() {
  frontDistance = readFrontDistanceCm();
  float battery = readBatteryPercent();

  String msg =
    "{\"type\":\"telemetry\",\"state\":{"
      "\"connected\":true,"
      "\"battery\":" + String(battery, 1) + ","
      "\"currentCommand\":\"" + currentCommand + "\","
      "\"speed\":" + String(max(abs(leftMotor), abs(rightMotor))) + ","
      "\"sensors\":{"
        "\"front_distance\":" + String(frontDistance, 1) + ","
        "\"battery\":" + String(battery, 1) +
      "},"
      "\"actuators\":{"
        "\"left_motor\":" + String(leftMotor) + ","
        "\"right_motor\":" + String(rightMotor) +
      "},"
      "\"camera\":null,"
      "\"errors\":[],"
      "\"link\":{\"latency\":0,\"rssi\":" + String(WiFi.RSSI()) + "},"
      "\"heartbeat\":" + String(millis()) +
    "}}";

  sendJson(msg);
}

void applyCommand(const String& cmd, int arg) {
  int speed = constrain(arg > 0 ? arg : 60, 0, 100);

  if (cmd == "FORWARD" || cmd == "WALK_FORWARD") {
    setMotorOutputs(speed, speed);
  } else if (cmd == "BACKWARD" || cmd == "WALK_BACKWARD") {
    setMotorOutputs(-speed, -speed);
  } else if (cmd == "TURN_LEFT") {
    setMotorOutputs(-speed, speed);
  } else if (cmd == "TURN_RIGHT") {
    setMotorOutputs(speed, -speed);
  } else if (
    cmd == "STOP" || cmd == "STAND" || cmd == "SIT" ||
    cmd == "LAND" || cmd == "HOME" || cmd == "EMERGENCY_STOP"
  ) {
    setMotorOutputs(0, 0);
  } else {
    sendLog("warn", "Unknown command: " + cmd);
    return;
  }

  currentCommand = cmd;
  sendLog("ok", "Command applied: " + cmd);
  sendTelemetry();
}

String extractStringField(const String& json, const String& key) {
  String needle = "\"" + key + "\":\"";
  int start = json.indexOf(needle);
  if (start < 0) return "";
  start += needle.length();

  int end = json.indexOf('"', start);
  if (end < 0) return "";
  return json.substring(start, end);
}

int extractIntField(const String& json, const String& key, int fallback) {
  String needle = "\"" + key + "\":";
  int start = json.indexOf(needle);
  if (start < 0) return fallback;
  start += needle.length();

  while (start < (int)json.length() && json[start] == ' ') start++;

  int end = start;
  while (end < (int)json.length() && isDigit(json[end])) end++;

  if (end == start) return fallback;
  return json.substring(start, end).toInt();
}

void handleTcpMessage(const String& line) {
  if (line.indexOf("\"type\":\"hello\"") >= 0) {
    sendHardware();
    sendLog("ok", "Laptop bridge handshake accepted");
    sendTelemetry();
    return;
  }

  if (line.indexOf("\"type\":\"command\"") >= 0) {
    String cmd = extractStringField(line, "cmd");
    int arg = extractIntField(line, "arg", 60);
    applyCommand(cmd, arg);
  }
}

void handleTcp() {
  if (!tcpClient || !tcpClient.connected()) {
    WiFiClient candidate = tcpServer.available();
    if (candidate) {
      tcpClient = candidate;
      rxLine = "";
      sendLog("ok", "Laptop connected");
    }
    return;
  }

  while (tcpClient.available()) {
    char c = (char)tcpClient.read();

    if (c == '\n') {
      rxLine.trim();
      if (rxLine.length()) handleTcpMessage(rxLine);
      rxLine = "";
    } else {
      if (rxLine.length() < 800) rxLine += c;
    }
  }
}

void handleDiscovery() {
  int packetSize = discoveryUdp.parsePacket();
  if (!packetSize) return;

  char packet[200];
  int n = discoveryUdp.read(packet, sizeof(packet) - 1);
  if (n <= 0) return;
  packet[n] = '\0';

  String request = String(packet);

  if (request.indexOf("\"type\":\"discover\"") < 0) return;
  if (request.indexOf("\"protocol\":1") < 0) return;

  String reply =
    "{\"type\":\"robot\",\"protocol\":1,"
    "\"id\":\"" + String(ROBOT_ID) + "\","
    "\"name\":\"" + String(ROBOT_NAME) + "\","
    "\"robot_type\":\"" + String(ROBOT_TYPE) + "\","
    "\"tcp_port\":" + String(TCP_PORT) + ","
    "\"firmware\":\"claude-robot-esp32\","
    "\"version\":\"2.0\"}";

  discoveryUdp.beginPacket(discoveryUdp.remoteIP(), discoveryUdp.remotePort());
  discoveryUdp.print(reply);
  discoveryUdp.endPacket();
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to Wi-Fi");
  unsigned long start = millis();

  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(300);
    Serial.print('.');
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("Wi-Fi connected");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());

    sendLog("ok", "Wi-Fi connected");
  } else {
    Serial.println("Wi-Fi connection failed");
  }
}

void setup() {
  Serial.begin(115200);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  if (LEFT_MOTOR_PIN >= 0) pinMode(LEFT_MOTOR_PIN, OUTPUT);
  if (RIGHT_MOTOR_PIN >= 0) pinMode(RIGHT_MOTOR_PIN, OUTPUT);

  setMotorOutputs(0, 0);

  connectWifi();

  discoveryUdp.begin(DISCOVERY_PORT);
  discoveryUdp.setTimeout(50);

  tcpServer.begin();

  Serial.println("Claude Robot ESP32 ready");
  Serial.printf("Discovery UDP: %u\n", DISCOVERY_PORT);
  Serial.printf("Robot TCP: %u\n", TCP_PORT);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastWifiCheck > 5000) {
      lastWifiCheck = millis();
      WiFi.disconnect();
      connectWifi();
    }
    delay(10);
    return;
  }

  handleDiscovery();
  handleTcp();

  if (millis() - lastTelemetry >= 700) {
    lastTelemetry = millis();

    if (tcpClient && tcpClient.connected()) {
      sendTelemetry();
    }
  }

  delay(2);
}
