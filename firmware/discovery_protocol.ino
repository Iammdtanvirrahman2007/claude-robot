/*
  ESP32 Robot Discovery Protocol
  Add this small UDP listener to your existing ESP32 robot firmware.

  The laptop bridge broadcasts:
    {"type":"discover","protocol":1}

  The ESP32 replies:
    {"type":"robot","protocol":1,"id":"R4","name":"TanvirBot","robot_type":"wheeled",
     "tcp_port":5000,"firmware":"claude-robot-esp32","version":"1.0"}
*/

#include <WiFi.h>
#include <WiFiUdp.h>

WiFiUDP discoveryUdp;
static constexpr uint16_t DISCOVERY_PORT = 4210;

const char* ROBOT_ID = "R4";
const char* ROBOT_NAME = "TanvirBot";
const char* ROBOT_TYPE = "wheeled";
const uint16_t ROBOT_TCP_PORT = 5000;

void startRobotDiscovery() {
  discoveryUdp.begin(DISCOVERY_PORT);
}

void handleRobotDiscovery() {
  int packetSize = discoveryUdp.parsePacket();
  if (!packetSize) return;

  char packet[160];
  int n = discoveryUdp.read(packet, sizeof(packet) - 1);
  packet[n] = '\0';

  if (strstr(packet, "\"type\":\"discover\"") == nullptr) return;
  if (strstr(packet, "\"protocol\":1") == nullptr) return;

  String reply = String(`{"type":"robot","protocol":1,"id":"`) + ROBOT_ID
    + String(`","name":"`) + ROBOT_NAME
    + String(`","robot_type":"`) + ROBOT_TYPE
    + String(`","tcp_port":`) + ROBOT_TCP_PORT
    + String(`,"firmware":"claude-robot-esp32","version":"1.0"}`);

  discoveryUdp.beginPacket(discoveryUdp.remoteIP(), discoveryUdp.remotePort());
  discoveryUdp.print(reply);
  discoveryUdp.endPacket();
}

// In setup():
//   startRobotDiscovery();
//
// In loop():
//   handleRobotDiscovery();
//
// Keep your existing TCP robot protocol running alongside this.
