// MOCK ESP32 FIRMWARE REPORTS — what each robot's firmware would send right after connect.
// The UI never checks a robot *type*; it only renders whatever sensors/actuators/controls are reported here.
const dist = (id, name, unit = 'cm', min = 8, max = 120) => ({ id, name, type: 'distance', unit, min, max, v: (min + max) / 2 })
const num = (id, name, type, unit, min, max, v, drift) => ({ id, name, type, unit, min, max, v, drift })
const imu = { id: 'imu', name: 'IMU', type: 'imu' }
const power = [num('battery', 'Battery', 'battery', '%', 0, 100, 87, 0.002), num('temperature', 'Temperature', 'temperature', '°C', 20, 70, 31.4, 0.01)]
const servo = (id, name, v = 45) => ({ id, name, type: 'servo', unit: '°', v })
const motor = (id, name) => ({ id, name, type: 'motor', unit: '%', v: 0 })
const ctl = (label, fn, cmd, pos, danger) => ({ label, fn, cmd, pos, danger })

const RAW = {
  spider: {
    label: 'Spider', defaults: { id: 'R1', ip: '192.168.1.101', port: 5000 },
    panels: { sensors: 'SENSORS', actuators: 'LEG CONTROL' },
    sensors: [dist('front_distance', 'Front Distance'), dist('left_distance', 'Left Distance'), dist('right_distance', 'Right Distance'), imu,
      num('leg_encoders', 'Leg Encoders', 'encoder', 'tk/s', 0, 400, 120), ...power],
    actuators: [42, 61, 35, 58, 40, 62, 37, 59].map((v, i) => servo(`leg_${i + 1}`, `Leg ${i + 1}`, v)),
    controls: [ctl('Walk Forward', 'walk_forward', 'WALK_FORWARD'), ctl('Walk Backward', 'walk_backward', 'WALK_BACKWARD'),
      ctl('Turn Left', 'turn_left', 'TURN_LEFT'), ctl('Turn Right', 'turn_right', 'TURN_RIGHT'), ctl('Stand', 'stand', 'STAND'), ctl('Sit', 'sit', 'SIT')],
    brain: { sensor: 'front_distance', lt: 30, hit: ['TURN_LEFT', 60], miss: ['WALK_FORWARD', 70] },
    code: `// SPIDER brain — runs on the LAPTOP. Sensor data arrives over Wi-Fi,
// commands go back to the ESP32, which moves the legs.

while (robot.connected())
{
    if (robot.front_distance() < 30)
    {
        robot.stop();
        robot.turn_left(60);
    }
    else
    {
        robot.walk_forward(70);
    }
}
`,
  },

  bird: {
    label: 'Bird', defaults: { id: 'R2', ip: '192.168.1.102', port: 5000 },
    panels: { sensors: 'FLIGHT SENSORS', actuators: 'FLIGHT CONTROL' },
    camera: { res: '1280 × 720', fps: 30 },
    sensors: [{ ...dist('obstacle', 'Obstacle Range (vision)', 'm', 1, 40), fn: 'camera.detect_obstacle' }, imu,
      { id: 'gps', name: 'GPS', type: 'gps' }, num('altitude', 'Altitude', 'altitude', 'm', 0, 120, 42, 0.03), ...power],
    actuators: [servo('left_wing', 'Left Wing', 90), servo('right_wing', 'Right Wing', 90), servo('tail', 'Tail', 90), motor('flight_motor', 'Flight Motor')],
    controls: [ctl('Takeoff', 'takeoff', 'TAKEOFF'), ctl('Land', 'land', 'LAND'), ctl('Forward', 'fly_forward', 'FLY_FORWARD'), ctl('Backward', 'fly_backward', 'FLY_BACKWARD'),
      ctl('Turn Left', 'turn_left', 'TURN_LEFT'), ctl('Turn Right', 'turn_right', 'TURN_RIGHT'),
      ctl('Increase Altitude', 'increase_altitude', 'INCREASE_ALTITUDE'), ctl('Decrease Altitude', 'decrease_altitude', 'DECREASE_ALTITUDE')],
    brain: { sensor: 'obstacle', lt: 8, hit: ['TURN_RIGHT', 40], miss: ['FLY_FORWARD', 70] },
    code: `// BIRD brain — runs on the LAPTOP. Camera frames and IMU/GPS stream in,
// wing / tail / motor commands stream back to the ESP32.

while (robot.connected())
{
    if (robot.camera.detect_obstacle())
    {
        robot.turn_right(40);
        robot.increase_altitude(20);
    }
    else
    {
        robot.fly_forward(70);
    }
}
`,
  },

  factory: {
    label: 'Factory', defaults: { id: 'R3', ip: '192.168.1.103', port: 5000 },
    panels: { sensors: 'PROCESS SENSORS', actuators: 'ARM & CONVEYOR' },
    camera: { res: '1920 × 1080', fps: 24 },
    sensors: [dist('part_proximity', 'Part Proximity', 'cm', 4, 60), num('part_weight', 'Part Weight', 'load', 'g', 0, 500, 180, 0.08),
      num('arm_torque', 'Arm Torque', 'torque', 'N·m', 0, 12, 3.2, 0.05), num('power_draw', 'Power Draw', 'power', 'W', 200, 900, 420, 0.03),
      num('temperature', 'Motor Temp', 'temperature', '°C', 20, 80, 38.5, 0.01)],
    actuators: [servo('base', 'Base Rotation', 90), servo('shoulder', 'Shoulder', 60), servo('elbow', 'Elbow', 110), servo('wrist', 'Wrist', 45),
      { id: 'gripper', name: 'Gripper', type: 'gripper', unit: '%', v: 0 }, motor('conveyor', 'Conveyor Belt')],
    controls: [ctl('Home Arm', 'home_arm', 'HOME'), ctl('Pick Part', 'pick_part', 'PICK_PART'), ctl('Place Part', 'place_part', 'PLACE_PART'),
      ctl('Open Gripper', 'open_gripper', 'OPEN_GRIPPER'), ctl('Close Gripper', 'close_gripper', 'CLOSE_GRIPPER'),
      ctl('Start Conveyor', 'conveyor_start', 'CONVEYOR_START'), ctl('Stop Conveyor', 'conveyor_stop', 'CONVEYOR_STOP'),
      ctl('E-STOP', 'emergency_stop', 'EMERGENCY_STOP', undefined, true)],
    brain: { sensor: 'part_proximity', lt: 15, hit: ['PICK_PART', 80], miss: ['CONVEYOR_START', 60] },
    code: `// FACTORY CELL brain — decision logic runs on the LAPTOP.
// The ESP32 only drives the arm and the conveyor.

robot.conveyor_start(60);

while (robot.connected())
{
    if (robot.part_proximity() < 15)
    {
        robot.conveyor_stop();
        robot.pick_part();
        robot.place_part();
        robot.conveyor_start(60);
    }
}
`,
  },

  wheeled: {
    label: 'Wheeled', defaults: { id: 'R4', ip: '192.168.1.104', port: 5000 },
    panels: { sensors: 'SENSORS', actuators: 'DRIVE' }, pad: true,
    sensors: [dist('front_distance', 'Front Distance'), num('line_sensor', 'Line Offset', 'line', '%', -100, 100, 0, 0.06),
      num('wheel_encoders', 'Wheel Encoders', 'encoder', 'tk/s', 0, 600, 240), imu, ...power],
    actuators: [motor('left_motor', 'Left Motor'), motor('right_motor', 'Right Motor'), servo('pan', 'Sensor Pan', 90)],
    controls: [ctl('↑', 'forward', 'FORWARD', '1 / 2'), ctl('←', 'turn_left', 'TURN_LEFT', '2 / 1'), ctl('■', 'stop', 'STOP', '2 / 2'),
      ctl('→', 'turn_right', 'TURN_RIGHT', '2 / 3'), ctl('↓', 'backward', 'BACKWARD', '3 / 2')],
    brain: { sensor: 'front_distance', lt: 25, hit: ['TURN_RIGHT', 90], miss: ['FORWARD', 60] },
    code: `// WHEELED brain — runs on the LAPTOP. Arrow keys also drive the robot manually.

while (robot.connected())
{
    if (robot.front_distance() < 25)
    {
        robot.stop();
        robot.turn_right(90);
    }
    else
    {
        robot.forward(60);
    }
}
`,
  },
}

export const CATALOG = Object.fromEntries(Object.entries(RAW).map(([type, e]) => [type, { ...e, type }]))
