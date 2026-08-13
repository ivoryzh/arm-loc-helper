import type { ParsedLocation, GridConfig, ApiType } from '../types';

export const generatePython = (locs: ParsedLocation[], configs: Record<string, GridConfig>, api: ApiType): string => {
  let pythonCode = `import time\n\n# Auto-generated ArmManager from URScript\n# Target API: ${api}\n\nclass ArmManager:\n    def __init__(self, robot_arm=None, gripper=None):\n        """\n        Initialize the ArmManager.\n        :param robot_arm: Instance of your robot controller\n        :param gripper: Instance of your gripper controller\n        """\n        self.robot = robot_arm\n        self.gripper = gripper\n        \n        # Hardcoded locations parsed from URScript\n        # Format: "Name": ("type", [coordinates])\n        self.locations = {\n`;

  locs.forEach(loc => {
    pythonCode += `            "${loc.name}": ("${loc.type}", ${loc.coordinates}),\n`;
  });

  pythonCode += `        }\n        \n        self.location_names = list(self.locations.keys())\n\n`;
  
  pythonCode += `    def open_gripper(self):\n        """Opens the gripper."""\n        if self.gripper:\n            self.gripper.open()\n        else:\n            print("Gripper not configured, cannot open.")\n            \n    def close_gripper(self):\n        """Closes the gripper."""\n        if self.gripper:\n            self.gripper.close()\n        else:\n            print("Gripper not configured, cannot close.")\n\n`;

  if (api === 'ti_robots') {
      pythonCode += `    def _move_cartesian(self, pose):\n        if self.robot:\n            self.robot.move_to_location(pose)\n        else:\n            print(f"Simulated cartesian move to: {pose}")\n\n`;
  } else {
      pythonCode += `    def _move_cartesian(self, pose):\n        if self.robot:\n            self.robot.move_linear(pose)\n        else:\n            print(f"Simulated cartesian move to: {pose}")\n\n`;
  }
  
  pythonCode += `    def _move_joints(self, joints):\n        if self.robot:\n            self.robot.move_joints(joints)\n        else:\n            print(f"Simulated joint move to: {joints}")\n\n`;
  
  pythonCode += `    # ==========================================\n    # Explicit Location Methods\n    # ==========================================\n`;

  locs.forEach(loc => {
    const config = configs[loc.name];
    
    if (loc.type === 'p' && config?.isGrid) {
      pythonCode += `
    def move_to_${loc.name}_grid(self, index: int):
        """Move to indexed location on ${loc.name} grid (Cols: ${config.cols}, Rows: ${config.rows})"""
        cols = ${config.cols}
        rows = ${config.rows}
        dx = ${config.dx}
        dy = ${config.dy}
        
        if index < 0 or index >= (cols * rows):
            raise ValueError(f"Index {index} out of bounds for ${loc.name} grid.")
            
        col = index % cols
        row = index // cols
        
        # Extract base coordinates (X, Y, Z, Rx, Ry, Rz)
        base_coords = list(self.locations["${loc.name}"][1])
        
        # Apply offsets
        base_coords[0] += col * dx
        base_coords[1] += row * dy
        
        print(f"Moving to ${loc.name} Grid Index {index} (Col: {col}, Row: {row})...")
        self._move_cartesian(base_coords)\n`;
    } else {
      if (loc.type === 'p') {
        pythonCode += `
    def move_to_${loc.name}(self):
        """Move to ${loc.name} (Cartesian)."""
        print(f"Moving to ${loc.name}...")
        self._move_cartesian(self.locations["${loc.name}"][1])\n`;
      } else {
        pythonCode += `
    def move_to_${loc.name}(self):
        """Move to ${loc.name} (Joints)."""
        print(f"Moving to ${loc.name}...")
        self._move_joints(self.locations["${loc.name}"][1])\n`;
      }
    }
  });

  return pythonCode;
};
