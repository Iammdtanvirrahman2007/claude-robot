#pragma once

#include <atomic>
#include <chrono>
#include <iostream>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>

class CameraAPI;

class Robot {
public:
  CameraAPI* cameraPtr = nullptr;

private:
  std::atomic<bool> online_{true};
  std::atomic<bool> running_{true};
  std::mutex stateMutex_;
  std::thread reader_;
  double frontDistance_ = 120.0;
  double obstacle_ = 40.0;
  double lineSensor_ = 0.0;
  double altitude_ = 0.0;
  double battery_ = 100.0;

  static double readNumber(const std::string& json, const std::string& key, double fallback) {
    const std::string needle = "\"" + key + "\":";
    auto p = json.find(needle);
    if (p == std::string::npos) return fallback;
    p += needle.size();
    while (p < json.size() && (json[p] == ' ' || json[p] == '\t')) ++p;
    try {
      size_t used = 0;
      const double v = std::stod(json.substr(p), &used);
      return used ? v : fallback;
    } catch (...) {
      return fallback;
    }
  }

  void readLoop() {
    std::string line;
    while (running_ && std::getline(std::cin, line)) {
      if (line.empty()) continue;

      const bool connected = line.find("\"connected\":true") != std::string::npos;
      online_ = connected;

      std::lock_guard<std::mutex> lock(stateMutex_);
      frontDistance_ = readNumber(line, "front_distance", frontDistance_);
      obstacle_ = readNumber(line, "obstacle", obstacle_);
      lineSensor_ = readNumber(line, "line_sensor", lineSensor_);
      altitude_ = readNumber(line, "altitude", altitude_);
      battery_ = readNumber(line, "battery", battery_);
    }

    online_ = false;
  }

  void command(const std::string& cmd, int arg = 0) const {
    std::cout << "{\"type\":\"command\",\"cmd\":\"" << cmd
              << "\",\"arg\":" << arg << "}" << std::endl;
  }

  void log(const std::string& text) const {
    std::cout << "{\"type\":\"log\",\"level\":\"info\",\"text\":\"";
    for (char c : text) {
      if (c == '\\' || c == '"') std::cout << '\\';
      std::cout << c;
    }
    std::cout << "\"}" << std::endl;
  }

public:
  Robot();
  ~Robot();

  bool connected() const { return online_.load(); }

  double front_distance() const {
    std::lock_guard<std::mutex> lock(stateMutex_);
    return frontDistance_;
  }

  double obstacle() const {
    std::lock_guard<std::mutex> lock(stateMutex_);
    return obstacle_;
  }

  double line_sensor() const {
    std::lock_guard<std::mutex> lock(stateMutex_);
    return lineSensor_;
  }

  double altitude() const {
    std::lock_guard<std::mutex> lock(stateMutex_);
    return altitude_;
  }

  double battery() const {
    std::lock_guard<std::mutex> lock(stateMutex_);
    return battery_;
  }

  void stop() { command("STOP", 0); }
  void forward(int speed = 60) { command("FORWARD", speed); }
  void backward(int speed = 60) { command("BACKWARD", speed); }
  void walk_forward(int speed = 60) { command("WALK_FORWARD", speed); }
  void walk_backward(int speed = 60) { command("WALK_BACKWARD", speed); }
  void turn_left(int speed = 60) { command("TURN_LEFT", speed); }
  void turn_right(int speed = 60) { command("TURN_RIGHT", speed); }
  void stand() { command("STAND", 0); }
  void sit() { command("SIT", 0); }

  void takeoff(int speed = 60) { command("TAKEOFF", speed); }
  void land() { command("LAND", 0); }
  void fly_forward(int speed = 60) { command("FLY_FORWARD", speed); }
  void fly_backward(int speed = 60) { command("FLY_BACKWARD", speed); }
  void increase_altitude(int speed = 20) { command("INCREASE_ALTITUDE", speed); }
  void decrease_altitude(int speed = 20) { command("DECREASE_ALTITUDE", speed); }

  void home_arm() { command("HOME", 0); }
  void pick_part() { command("PICK_PART", 80); }
  void place_part() { command("PLACE_PART", 80); }
  void open_gripper() { command("OPEN_GRIPPER", 100); }
  void close_gripper() { command("CLOSE_GRIPPER", 100); }
  void conveyor_start(int speed = 60) { command("CONVEYOR_START", speed); }
  void conveyor_stop() { command("CONVEYOR_STOP", 0); }
  void emergency_stop() { command("EMERGENCY_STOP", 0); }

  void wait_ms(unsigned long ms) const {
    std::this_thread::sleep_for(std::chrono::milliseconds(ms));
  }

  void print(const std::string& text) const { log(text); }
};

class CameraAPI {
  Robot* robot_;
public:
  explicit CameraAPI(Robot* robot) : robot_(robot) {}
  bool detect_obstacle() const { return robot_->obstacle() < 8.0; }
};

inline Robot::Robot() {
  cameraPtr = nullptr;
  reader_ = std::thread([this] { readLoop(); });
}

inline Robot::~Robot() {
  running_ = false;
  online_ = false;
  if (reader_.joinable()) reader_.join();
}

// The editor exposes robot.camera.detect_obstacle().

