from ti_robots.universal_robots.ur3 import UR3Arm
from ti_robots.universal_robots.urscript_sequence import URScriptSequence
from ti_robots.grids import Grid, Cartesian
from ti_robots.robotics import Location
from automated_lle.components.logger.logger import logger
import logging
from typing import Union
from automated_lle.resources.resource_handler import Handler

import string
import functools
import time

# import your sequence(s) from a URScript file
lle_deck_sequence = r"D:\git_repositories\automated-lle\automated_lle\components\sequences\LLE_Deck_New.script"
# Get UR arm IP address
UR5_ADDRESS = "137.82.65.136"

logging.getLogger('ursecmon').setLevel(logging.ERROR)
logging.getLogger('urx').setLevel(logging.ERROR)
logging.getLogger('ti_robots').setLevel(logging.ERROR)

def tool_check_on(func):
    """ Decorator to check if the MLH is the active tool and prevent actions if not."""

    @functools.wraps(func)
    def wrapper(self, *args, **kwargs):
        if not self.mlh_active:
            raise ToolStateError("Error: MLH is not the active tool. Cannot complete action.")
        else:
            return func(self, *args, **kwargs)
    return wrapper


def tool_check_off(func):
    """ Decorator to check if the MLH is not currently the active tool."""

    @functools.wraps(func)
    def wrapper(self, *args, **kwargs):
        if self.mlh_active:
            raise ToolStateError("Error: MLH is the active tool. Cannot complete action.")
        else:
            return func(self, *args, **kwargs)
    return wrapper


class ArmManager:
    # Updated with new Adaptive Gripper on March 2026

    # 4dram vial plate
    A1_4DRAM_PLATE = "A1_4DRAM_On"
    SAFE_4DRAM_VIAL_PLATE = "A1_4DRAM_Safe"

    # HPLC vial plate
    HPLC_A1 = "HPLC_Vial_On"
    SAFE_HPLC_VIAL_PLATE = "HPLC_Vial_Safe"
    HPLC_MIX_APPROACH = "HPLC_mix_appr"
    HPLC_MIX_1 = "HPLC_mix_1"
    HPLC_MIX_2 = "HPLC_mix_2"

    # HPLC instrument
    HPLC_INSTRUMENT_APPROACH = "HPLC_Inst_Appr"
    HPLC_INSTRUMENT_APPROACH_P2 = "HPLC_Inst_P2"
    HPLC_INSTRUMENT_APPROACH_P3 = "HPLC_Inst_P3"
    HPLC_INSTRUMENT_APPROACH_P4 = "HPLC_Inst_P4"
    HPLC_INSTRUMENT_VIAL_IN = "HPLC_Inst_In"

    # Safe positions and axis changes
    ARM_SAFE = 'ARM_Home'
    ARM_SAFE_RIGHT = 'ARM_Home_R'
    MLH_ACTIVE_SAFE = 'MLH_Active_Safe'
    MLH_ACTIVE_SAFE_RIGHT = 'ARM_Home_R'
    # note safe horizontal location for arm on the right is the same as with MLH

    # Balance
    BALANCE_APPROACH = "Balance_Appr"
    BALANCE_HPLC_IN = "Balance_Vial_In"
    BALANCE_HPLC_UP = "Balance_Vial_Up"
    BALANCE_4DRAM_HOLDER_APPROACH = "Bal_Holder_Appr"
    BALANCE_4DRAM_HOLDER_UP = "Bal_Holder_Up"
    BALANCE_4DRAM_HOLDER_IN = "Bal_Holder_In"

    # EasyMax reactor 4 dram
    EASYMAX_4DRAM_VIAL_IN = 'Arm_Vial_EM_In'
    EASYMAX_4DRAM_VIAL_UP = 'Arm_Vial_EM_Top'

    # Mobile Liquid Handler (MLH)
    MLH_A1_HPLC = 'MLH_Vial_On'
    MLH_HPLC_PLATE_SAFE = 'MLH_Vial_Safe'
    MLH_A1_4DRAM = 'MLH_4DRAM_On'
    MLH_4DRAM_PLATE_SAFE = 'MLH_4DRAM_Safe'
    MLH_EASYMAX_VIAL_ON = 'MLH_EM_On'
    MLH_EASYMAX_VIAL_SAFE = 'MLH_EM_Safe'
    MLH_APPROACH = 'MLH_Safe'
    MLH_APPROACH_P2 = 'MLH_Interim'
    MLH_PICKUP = 'MLH_On'
    MLH_SOLVENT_PLATE = "MLH_Solv_Safe"
    MLH_A1_SOLVENTS = "MLH_Solv_On"

    # 4Dram holder for balance
    HOLDER_4DRAM_VIAL_IN = "Holder_4DRAM_In"
    HOLDER_4DRAM_UP = 'Holder_4DRAM_Up'
    HOLDER_4DRAM_PICKUP = 'Holder_In'
    HOLDER_4DRAM_PICKUP_UP = "Holder_Safe"

    # Robotiq LLE custom fingers - Gripper positions
    GRIPPER_4DRAM_OPEN = 0.65
    GRIPPER_4DRAM_CLOSE = 1
    GRIPPER_HPLC_OPEN = 0.78
    GRIPPER_HPLC_CLOSE = 1
    GRIPPER_MLH_OPEN = 0
    GRIPPER_MLH_CLOSE = 1
    GRIPPER_4DRAM_HOLDER_OPEN = 0.50
    GRIPPER_4DRAM_HOLDER_CLOSE = 1
    GRIPPER_OPEN_DEFAULT = 0.50
    GRIPPER_CLOSE_DEFAULT = 0.9

    def __init__(self, arm_address: str, sequence_path: str):
        """
        Initialize the ArmManager with a UR3Arm instance and a sequence file path.

        :param arm_adress: IP address of UR arm.
        :param sequence_path: Path to the URScript sequence file.
        """
        logger.debug("Initializing robotic arm class with sequence: %s", sequence_path)

        self.arm = UR3Arm(arm_address, default_joint_velocity=50)
        self.sequences = URScriptSequence(sequence_path)
        self.mlh_active = False
        self.resource_handler = Handler()
        self.solvents_tray = self.resource_handler.make_tray(self.sequences[self.MLH_A1_SOLVENTS],  rows=2, columns=5,
                                                             spacing=Cartesian(42, 38.75), tray_name="solvent",
                                                             mlh_top_left=self.sequences[self.MLH_A1_SOLVENTS])
        self.extraction_tray = self.resource_handler.make_tray(self.sequences[self.A1_4DRAM_PLATE], rows=3, columns=5,
                                                               spacing=Cartesian(27, 24.5, 0),
                                                               mlh_top_left=self.sequences[self.MLH_A1_4DRAM],
                                                               tray_name="extraction")
        self.hplc_tray = self.resource_handler.make_tray(self.sequences[self.HPLC_A1].translate(z=0.5), rows=6, columns=9,
                                                         spacing=Cartesian(13.9, 13.9, 0),
                                                         mlh_top_left=self.sequences[self.MLH_A1_HPLC],
                                                         tray_name="hplc")

    def open_gripper(self):
        """
        Open the gripper to the default open position.
        """
        logger.debug("Opening gripper to default position: %f", self.GRIPPER_OPEN_DEFAULT)
        self.arm.open_gripper(self.GRIPPER_OPEN_DEFAULT)

    def close_gripper(self):

        """
        Close the gripper to the default close position.
        """
        logger.debug("Closing gripper to default position: %f", self.GRIPPER_CLOSE_DEFAULT)
        self.arm.close_gripper(self.GRIPPER_CLOSE_DEFAULT)

    @tool_check_off
    def home_arm(self):
        """
        Move the arm to the horizontal safe position.
        """
        logger.debug("Moving arm to horizontal safe position.")
        lle_safe = self.sequences.joints[self.ARM_SAFE]
        self.arm.move_joints(lle_safe)

    @tool_check_off
    def home_arm_R(self):
        logger.debug("Moving arm to horizontal safe position.")
        arm_safe_R = self.sequences.joints[self.ARM_SAFE_RIGHT]
        self.arm.move_joints(arm_safe_R)

    @tool_check_on
    def mlh_safe(self):
        """
        Move the arm to the safe position when the MLH is the active tool.
        """
        logger.debug("Moving arm to MLH active safe position.")
        lle_mlh_safe = self.sequences.joints[self.MLH_ACTIVE_SAFE]
        self.arm.move_joints(lle_mlh_safe)

    @tool_check_on
    def mlh_safe_right(self):
        """
        Move the arm to the safe position when the MLH is the active tool.
        """
        logger.debug("Moving arm to MLH active safe position.")
        lle_mlh_safe = self.sequences.joints[self.MLH_ACTIVE_SAFE_RIGHT]
        self.arm.move_joints(lle_mlh_safe)

    @tool_check_off
    def mlh_pickup(self):
        """"
        Move the arm to pickup the MLH and return to a safe position.
        """

        logger.debug("Picking up the MLH from charging post.")
        
        lle_mlh_approach = self.sequences.joints[self.MLH_APPROACH]
        lle_mlh_approach_2 = self.sequences[self.MLH_APPROACH_P2]
        lle_mlh_pickup = self.sequences[self.MLH_PICKUP]

        self.home_arm()
        self.arm.open_gripper(self.GRIPPER_MLH_OPEN)
        self.arm.move_joints(lle_mlh_approach)
        self.arm.move_to_locations(lle_mlh_approach_2)
        self.arm.move_to_locations(lle_mlh_pickup, velocity=self.arm.default_velocity*0.5)
        self.arm.close_gripper(self.GRIPPER_MLH_CLOSE)
        self.object_detected()
        self.arm.move_to_locations(lle_mlh_approach_2, velocity=self.arm.default_velocity*0.5)
        self.arm.move_joints(lle_mlh_approach)

        self.mlh_active = True
        self.mlh_safe()

    @tool_check_on
    def mlh_return(self):
        """"
        Move the arm to return the MLH to its stand and return to a safe position.
        """
        logger.debug("Return the MLH to charging post.")

        lle_mlh_approach = self.sequences.joints[self.MLH_APPROACH]
        lle_mlh_approach_2 = self.sequences[self.MLH_APPROACH_P2]
        lle_mlh_pickup = self.sequences[self.MLH_PICKUP]

        self.mlh_safe()
        self.arm.move_joints(lle_mlh_approach)
        self.arm.move_to_locations(lle_mlh_approach_2)
        self.arm.move_to_locations(lle_mlh_pickup, velocity=self.arm.default_velocity*0.5)
        self.arm.open_gripper(self.GRIPPER_MLH_OPEN)
        self.arm.move_to_locations(lle_mlh_approach_2, velocity=self.arm.default_velocity*0.5)
        self.arm.move_joints(lle_mlh_approach)

        self.mlh_active = False
        self.home_arm()

    @tool_check_on
    def mlh_to_container(self, index : str = 'A1', tray: str = None):

        if tray.lower() == 'solvent':
            self.mlh_to_solvent_vial(solvent=index)
        elif tray.lower() == 'extraction':
            self.mlh_to_4dram_vial(vial=index)
        elif tray.lower() == 'hplc':
            self.mlh_to_hplc_vial(vial=index)
        elif tray.lower() in ['easymax', 'reactor']:
            self.mlh_to_easymax_vial()
        else:
            raise ValueError(f"Invalid tray {tray}. Use 'solvent', 'extraction', 'hplc', 'reactor', or 'easymax'.")

    @tool_check_on    
    def mlh_from_container(self, index : str = 'A1', tray: str = None):

        if tray == 'solvent':
            self.mlh_from_solvent_vial(solvent=index)
        elif tray == 'extraction':
            self.mlh_from_4dram_vial(vial=index)
        elif tray == 'hplc':
            self.mlh_from_hplc_vial(vial=index)
        elif tray in ['easymax', 'reactor']:
            self.mlh_from_easymax_vial()
        else:
            raise ValueError("Invalid tray {tray}. Use 'solvent', 'extraction', 'hplc', 'reactor', or 'easymax'.")

    #### MLH-Vial Interactions

    @tool_check_on
    def mlh_to_4dram_vial(self, vial: str = 'A1'):
        """
        Moves the robotic arm to a specified vial in the 4-dram plate.
        
        :param vial: The well identifier for the vial plate. Default is 'A1'.
                
        """
        
        v = self.extraction_tray[vial]
        
        logger.debug("Moving arm to the 4-dram vial plate, well: %s", v.well_name)

        vial_loc = v.mlh_location
        lle_mlh_4dram_plate = self.sequences.joints[self.MLH_4DRAM_PLATE_SAFE]

        self.mlh_safe()
        self.arm.move_joints(lle_mlh_4dram_plate)
        self.arm.move_to_locations(vial_loc.translate(z=100))
        self.arm.move_to_locations(vial_loc, velocity=self.arm.default_velocity*0.5)

    @tool_check_on
    def mlh_from_4dram_vial(self, vial: str = 'A1'):
        """
        Moves the robotic arm from a specified vial in the 4-dram plate.
        
        :param vial: The well identifier for the vial plate. Default is 'A1'.
        
        """

        v = self.extraction_tray[vial]

        logger.debug("Moving arm from the 4-dram vial plate, well: %s", v.well_name)
        vial_loc= v.mlh_location

        self.arm.move_to_locations(vial_loc.translate(z=200))
        self.mlh_safe()

    @tool_check_on
    def mlh_to_hplc_vial(self, vial: str = 'A1'):
        """
        Moves the robotic arm with the MLH as the active tool to a specified vial in the hplc plate.

        :param vial: The well identifier for the vial plate. Default is 'A1'.
        
        """

        v = self.hplc_tray[vial]

        logger.debug("Moving MLH to the hplc vial plate, well: %s.", v.well_name)

        vial_loc= v.mlh_location

        hplc_plate_safe = self.sequences.joints[self.MLH_HPLC_PLATE_SAFE]

        self.mlh_safe()
        self.arm.move_joints(hplc_plate_safe)
        self.arm.move_to_locations(vial_loc.translate(z=100))
        self.arm.move_to_locations(vial_loc, velocity=self.arm.default_velocity*0.5)

    @tool_check_on
    def mlh_from_hplc_vial(self, vial: str = 'A1'):
        """
        Moves the robotic arm with the MLH as the active tool from a specified vial in the hplc plate.

        :param vial: The well identifier for the vial plate. Default is 'A1'.
        
        """

        v = self.hplc_tray[vial]

        logger.debug("Moving MLH to the hplc vial plate, well: %s.", v.well_name)

        vial_loc = v.mlh_location

        self.arm.move_to_locations(vial_loc.translate(z=200))
        self.mlh_safe()

    @tool_check_on
    def mlh_to_solvent_vial(self, solvent: str = "Water"):
        """
        Moves the robotic arm with the MLH as the active tool to the solvent tray mid position.

        :param slot: The well identifier for the vial plate. Default is 'A1'.
        :param solvent: Name of the solvent to use for the action. Ensure that name is in the list of available ones
        """
        v = self.solvents_tray[solvent]
        vial_loc = v.location

        solvents_plate_safe = self.sequences.joints[self.MLH_SOLVENT_PLATE]

        logger.debug("Moving MLH to the solvent vial tray, well: %s.", v.well_name)

        self.mlh_safe()
        self.arm.move_joints(solvents_plate_safe)
        self.arm.move_to_locations(vial_loc.translate(z=100))
        self.arm.move_to_locations(vial_loc, velocity=self.arm.default_velocity*0.5)

    @tool_check_on
    def mlh_from_solvent_vial(self, solvent: str = "Water"):
        """
        Moves the robotic arm with the MLH as the active tool from the solvent tray mid position.

        :param solvent: Name of the solvent to use for the action. Ensure that name is in the list of available ones
        """
        v = self.solvents_tray[solvent]
        vial_loc= v.location

        logger.debug("Moving MLH from the solvent vial tray, well: %s.", v.well_name)

        self.arm.move_to_locations(vial_loc.translate(z=200))
        self.mlh_safe()

    @tool_check_on
    def mlh_to_easymax_vial(self):
        """
        Moves the robotic arm with the MLH as the active tool to the EasyMax vial front slot.

        """
        logger.debug("Moving MLH to the EasyMax front vial slot.")

        easymax_vial_top = self.sequences.joints[self.MLH_EASYMAX_VIAL_SAFE]
        easymax_vial = self.sequences[self.MLH_EASYMAX_VIAL_ON]

        self.mlh_safe()
        self.arm.move_joints(easymax_vial_top)
        self.arm.move_to_locations(easymax_vial)


    @tool_check_on
    def mlh_from_easymax_vial(self):
        """
        Moves the robotic arm with the MLH as the active tool from the EasyMax vial front slot.

        """
        logger.debug("Moving MLH from the EasyMax front vial slot.")

        easymax_vial_top = self.sequences[self.MLH_EASYMAX_VIAL_SAFE]

        self.arm.move_to_locations(easymax_vial_top)
        self.mlh_safe()

    #######################
    # Generalized Container Functions
    #######################    

    def container_from_tray(self, index: str = 'A1', tray: str = None):

        if tray == 'hplc':
            self.hplc_vial_pickup(vial=index)
        elif tray == 'extraction':
            self.extraction_vial_pickup(vial=index)
        else:
            raise ValueError(f"Invalid tray {tray}. Use 'hplc' or 'extraction'.")
        
    def container_to_tray(self, index: str = 'A1', tray: str = None):
        if tray == 'hplc':
            self.hplc_vial_return(vial=index)
        elif tray == 'extraction':
            self.extraction_vial_return(vial=index)
        else:
            raise ValueError(f"Invalid tray {tray}. Use 'hplc' or 'extraction'.")
        
    @tool_check_off
    def container_to_balance_approach(self, tray: str = None):
        """
        Moves the extraction vial to the balance holder or exchange stage. 
        """
        if tray == 'extraction':
            self.extraction_vial_to_holder()
        elif tray == 'hplc':
            self.home_arm_R()
        else:
            raise ValueError(f"Invalid tray {tray}. Use 'hplc' or 'extraction'.")

    @tool_check_off
    def container_from_balance_approach(self, tray: str = None):
        """
        Moves the extraction vial from the balance holder or exchange stage. 
        """
        if tray == 'extraction':
            self.extraction_vial_from_holder()
        elif tray == 'hplc':
            self.home_arm_R()
        else:
            raise ValueError(f"Invalid tray {tray}. Use 'hplc' or 'extraction'.")
    
    @tool_check_off
    def container_to_balance(self, tray: str = None):
        """
        Moves the extraction vial to the balance holder or exchange stage. 
        """
        if tray == 'extraction':
            self.extraction_vial_holder_to_balance()
        elif tray == 'hplc':
            self.hplc_vial_to_balance()
        else:
            raise ValueError(f"Invalid tray {tray}. Use 'hplc' or 'extraction'.")
    
    @tool_check_off
    def container_from_balance(self, tray: str = None):
        """
        Moves the extraction vial from the balance holder or exchange stage. 
        """
        if tray == 'extraction':
            self.extraction_vial_holder_from_balance()
        elif tray == 'hplc':
            self.hplc_vial_from_balance()
        else:
            raise ValueError(f"Invalid tray {tray}. Use 'hplc' or 'extraction'.")

    #######################
    # Container Functions by tray type
    #######################

    @tool_check_off
    def extraction_vial_to_easymax(self, vial: str = 'A1'):
        """
        Picks up the extraction vial, from a specified slot, and moves it to the EasyMax vial front slot.

        :param vial: The well identifier for the vial plate. Default is 'A1'.
        """

        logger.debug("Moving extraction vial, well %s, to the EasyMax front vial slot.", vial)

        easymax_vial_top = self.sequences.joints[self.EASYMAX_4DRAM_VIAL_UP]
        easymax_vial = self.sequences[self.EASYMAX_4DRAM_VIAL_IN]

        self.home_arm()
        self.arm.move_joints(easymax_vial_top)
        self.arm.move_to_locations(easymax_vial, velocity=self.arm.default_velocity*0.5)
        self.arm.open_gripper(self.GRIPPER_4DRAM_OPEN)
        self.arm.move_to_locations(easymax_vial.translate(z=200))
        self.home_arm()

    @tool_check_off
    def extraction_vial_from_easymax(self, vial: str = 'A1'):
        """
        Picks up the extraction vial from the EasyMax vial front slot back to a specified slot.

        :param vial: The well identifier for the vial plate. Default is 'A1'.
        """

        logger.debug("Moving extraction vial from the EasyMax front vial slot to well %s,", vial)

        easymax_vial = self.sequences[self.EASYMAX_4DRAM_VIAL_IN]
        easymax_vial_top = self.sequences.joints[self.EASYMAX_4DRAM_VIAL_UP]
        easymax_vial_top_loc = self.sequences[self.EASYMAX_4DRAM_VIAL_UP]

        self.home_arm()

        self.arm.move_joints(easymax_vial_top)
        self.arm.close_gripper(self.GRIPPER_4DRAM_OPEN)

        self.attempt_grip_with_retry(easymax_vial_top_loc, easymax_vial.translate(z=2), self.GRIPPER_4DRAM_OPEN)

        self.home_arm()

    @tool_check_off
    def from_hplc_instrument(self):
        """
        Moves the arm back to a safe position from the HPLC instrument.
        """
        logger.info("Moving arm back from the HPLC instrument.")

        self.home_arm_R()
        self.home_arm()

    @tool_check_off
    def hplc_vial_pickup(self, vial: str = 'A1'):
        """
        Picks up a vial from the HPLC vial plate at a specified slot.

        :param vial: The well identifier for the vial plate. Default is 'A1'.
        """

        hplc_plate = self.sequences.joints[self.SAFE_HPLC_VIAL_PLATE]

        v = self.hplc_tray[vial]

        logger.info("Picking up vial from the HPLC vial plate, well: %s.", v.well_name)

        vial_loc = v.location

        self.home_arm()
        self.arm.move_joints(hplc_plate)
        self.arm.open_gripper(self.GRIPPER_HPLC_OPEN)
        self.arm.move_to_locations(vial_loc.translate(z=100))

        self.attempt_grip_with_retry(vial_loc.translate(z=100), vial_loc, self.GRIPPER_HPLC_OPEN)

        self.home_arm()

    @tool_check_off
    def hplc_vial_return(self, vial: str = 'A1'):
        """
        Returns a vial to the HPLC vial plate at a specified slot.

        :param vial: The well identifier for the vial plate. Default is 'A1'.
        """
        v = self.hplc_tray[vial]
        vial_loc = v.location

        logger.info("Returning vial to the HPLC vial plate, well: %s.", v.well_name)

        hplc_plate = self.sequences.joints[self.SAFE_HPLC_VIAL_PLATE]

        self.home_arm()
        self.arm.move_joints(hplc_plate)
        self.arm.move_to_locations(vial_loc.translate(z=100))
        self.arm.move_to_locations(vial_loc, velocity=self.arm.default_velocity*0.5)
        self.arm.close_gripper(self.GRIPPER_HPLC_OPEN)
        self.arm.move_to_locations(vial_loc.translate(z=100))
        self.home_arm()

    @tool_check_off
    def extraction_vial_pickup(self, vial: str = 'A1'):
        """
        Picks up a vial from the 4-dram vial plate at a specified slot.

        :param vial: The well identifier for the vial plate. Default is 'A1'.
        """

        extraction_plate = self.sequences.joints[self.SAFE_4DRAM_VIAL_PLATE]
       
        v = self.extraction_tray[vial]

        logger.info("Picking up vial from the 4-dram vial plate, well: %s.", v.well_name)

        vial_loc = v.location

        self.home_arm()
        self.arm.move_joints(extraction_plate)
        self.arm.close_gripper(self.GRIPPER_4DRAM_OPEN)
        self.arm.move_to_locations(vial_loc.translate(z=100))

        self.attempt_grip_with_retry(vial_loc.translate(z=100), vial_loc, self.GRIPPER_4DRAM_OPEN)

        self.home_arm()

    @tool_check_off
    def extraction_vial_return(self, vial: str = 'A1'):
        """
        Returns a vial to the 4-dram vial plate at a specified slot.

        :param vial: The well identifier for the vial plate. Default is 'A1'.
        """

        extraction_plate = self.sequences.joints[self.SAFE_4DRAM_VIAL_PLATE]
        
        v = self.extraction_tray[vial]
        
        logger.info("Returning vial to the 4-dram vial plate, well: %s.", v.well_name)

        vial_loc = v.location

        self.home_arm()
        self.arm.move_joints(extraction_plate)
        self.arm.move_to_locations(vial_loc.translate(z=100))
        self.arm.move_to_locations(vial_loc, velocity=self.arm.default_velocity*0.5)
        self.arm.close_gripper(self.GRIPPER_4DRAM_OPEN)
        self.arm.move_to_locations(vial_loc.translate(z=100))
        self.home_arm()

    @tool_check_off
    def hplc_vial_to_balance(self):
        """
        Moves an HPLC vial to the balance instrument.
        """
        logger.debug("Moving HPLC vial to the balance.")

        balance_approach = self.BALANCE_APPROACH
        balance_up = self.BALANCE_HPLC_UP
        balance_vial_in = self.BALANCE_HPLC_IN

        self.home_arm_R()
        self.arm.move_joints(self.sequences.joints[balance_approach])
        self.arm.move_to_locations(self.sequences[balance_up])
        self.arm.move_to_locations(self.sequences[balance_vial_in].translate(z=1))
        self.arm.close_gripper(self.GRIPPER_HPLC_OPEN)
        self.arm.move_to_locations(self.sequences[balance_up])
        self.arm.move_to_locations(self.sequences[balance_approach])
        self.home_arm_R()

    @tool_check_off
    def hplc_vial_from_balance(self):
        """
        Picks up the HPLC vial to the balance instrument.
        """
        logger.debug("Removing HPLC vial from the balance.")

        balance_approach = self.sequences.joints[self.BALANCE_APPROACH]
        balance_approach_loc = self.sequences[self.BALANCE_APPROACH]
        balance_up = self.sequences[self.BALANCE_HPLC_UP]
        balance_vial_in = self.sequences[self.BALANCE_HPLC_IN]

        self.home_arm_R()
        self.arm.move_joints(balance_approach)
        self.arm.move_to_locations(balance_up)
        self.arm.close_gripper(self.GRIPPER_HPLC_OPEN)

        self.attempt_grip_with_retry(balance_up, balance_vial_in, self.GRIPPER_HPLC_OPEN)

        self.arm.move_to_locations(balance_approach_loc)
        self.home_arm_R()


    @tool_check_off
    def vial_to_hplc_instrument(self, mix: bool = False):
        """
        Moves the HPLC vial from the exchange platform to the HPLC instrument, at a specified slot.

        :param slot: Slot identifier of the HPLC instrument injection tray. Default is "A"
        """

        hplc_approach = self.sequences.joints[self.HPLC_INSTRUMENT_APPROACH]
        hplc_approach_loc = self.sequences[self.HPLC_INSTRUMENT_APPROACH]
        hplc_approach_p2 = self.sequences[self.HPLC_INSTRUMENT_APPROACH_P2]
        hplc_approach_p3 = self.sequences[self.HPLC_INSTRUMENT_APPROACH_P3]
        hplc_approach_p4 = self.sequences[self.HPLC_INSTRUMENT_APPROACH_P4]
        hplc_vial_in = self.sequences[self.HPLC_INSTRUMENT_VIAL_IN]

        logger.debug("Moving HPLC vial to the HPLC instrument")

        self.home_arm_R()
        if mix:
            self.mix_hplc_vial()
        else:
            pass
        self.arm.move_joints(hplc_approach)
        self.arm.move_to_locations(hplc_approach_p2)
        self.arm.move_to_locations(hplc_approach_p3, velocity=self.arm.default_velocity*0.5)
        self.arm.move_to_locations(hplc_approach_p4, velocity=self.arm.default_velocity*0.5)
        self.arm.move_to_locations(hplc_vial_in, velocity=self.arm.default_velocity*0.5)
        self.arm.close_gripper(self.GRIPPER_HPLC_OPEN)
        self.arm.move_to_locations(hplc_approach_p4, velocity=self.arm.default_velocity*0.5)
        self.arm.move_to_locations(hplc_approach_p3, velocity=self.arm.default_velocity*0.5)
        self.arm.move_to_locations(hplc_approach_p2, velocity=self.arm.default_velocity*0.5)
        self.arm.move_to_locations(hplc_approach_loc)
        self.home_arm_R()

    @tool_check_off
    def vial_from_hplc_instrument(self, slot: str = 'A'):
        """
        Picks up the HPLC vial from the HPLC instrument, at a specified slot, to the exchange platform.

        :param slot: Slot identifier of the HPLC instrument injection tray. Default is "A"
        """

        hplc_approach = self.sequences.joints[self.HPLC_INSTRUMENT_APPROACH]
        hplc_approach_loc = self.sequences[self.HPLC_INSTRUMENT_APPROACH]
        hplc_approach_p2 = self.sequences[self.HPLC_INSTRUMENT_APPROACH_P2]
        hplc_approach_p3 = self.sequences[self.HPLC_INSTRUMENT_APPROACH_P3]
        hplc_approach_p4 = self.sequences[self.HPLC_INSTRUMENT_APPROACH_P4]
        hplc_vial_in = self.sequences[self.HPLC_INSTRUMENT_VIAL_IN]

        logger.debug("Moving HPLC vial to the HPLC instrument")

        self.home_arm_R()
        self.arm.move_joints(hplc_approach)
        self.arm.close_gripper(self.GRIPPER_HPLC_OPEN)
        self.arm.move_to_locations(hplc_approach_p2)
        self.arm.move_to_locations(hplc_approach_p3, velocity=self.arm.default_velocity * 0.5)
        self.arm.move_to_locations(hplc_approach_p4, velocity=self.arm.default_velocity * 0.5)
        self.arm.move_to_locations(hplc_vial_in, velocity=self.arm.default_velocity * 0.5)
        self.arm.close_gripper(self.GRIPPER_HPLC_CLOSE)
        self.arm.move_to_locations(hplc_approach_p4, velocity=self.arm.default_velocity * 0.5)
        self.arm.move_to_locations(hplc_approach_p3, velocity=self.arm.default_velocity * 0.5)
        self.arm.move_to_locations(hplc_approach_p2, velocity=self.arm.default_velocity * 0.5)
        self.arm.move_to_locations(hplc_approach_loc)
        self.home_arm_R()

    @tool_check_off
    def mix_hplc_vial(self):
        self.arm.move_joints(self.sequences.joints[self.HPLC_MIX_APPROACH])
        self.arm.move_joints(self.sequences.joints[self.HPLC_MIX_1], velocity=self.arm._max_joint_velocity)
        self.arm.move_joints(self.sequences.joints[self.HPLC_MIX_2], velocity=self.arm._max_joint_velocity)
        self.arm.move_joints(self.sequences.joints[self.HPLC_MIX_1], velocity=self.arm._max_joint_velocity)
        self.arm.move_joints(self.sequences.joints[self.HPLC_MIX_APPROACH], velocity=self.arm._max_joint_velocity)

    @tool_check_off    
    def extraction_vial_to_holder(self):
        
        logger.debug("Moving extraction vial to balance holder.")

        balance_holder_up = self.sequences.joints[self.HOLDER_4DRAM_UP]
        holder_vial_in = self.sequences[self.HOLDER_4DRAM_VIAL_IN]

        balance_holder_up_loc = self.sequences[self.HOLDER_4DRAM_UP]
        balance_holder_pickup = self.sequences[self.HOLDER_4DRAM_PICKUP]

        self.home_arm()
        self.arm.move_joints(balance_holder_up)
        self.arm.move_to_locations(holder_vial_in.translate(z=2))
        self.arm.close_gripper(self.GRIPPER_4DRAM_OPEN)
        self.arm.move_to_locations(holder_vial_in.translate(z=100))
        self.arm.open_gripper(self.GRIPPER_4DRAM_HOLDER_OPEN)

        self.attempt_grip_with_retry(balance_holder_up_loc, balance_holder_pickup, self.GRIPPER_4DRAM_HOLDER_OPEN)

        self.home_arm_R()

    @tool_check_off
    def extraction_vial_from_holder(self):
        
        logger.debug("Moving extraction vial from balance holder")

        holder_vial_in = self.sequences[self.HOLDER_4DRAM_VIAL_IN]
        balance_holder_up_loc = self.sequences[self.HOLDER_4DRAM_UP]
        balance_holder_up = self.sequences.joints[self.HOLDER_4DRAM_UP]
        balance_holder_pickup = self.sequences[self.HOLDER_4DRAM_PICKUP]

        self.home_arm_R()
        self.arm.move_joints(balance_holder_up)
        self.arm.move_to_locations(balance_holder_pickup.translate(z=1))
        self.arm.open_gripper(self.GRIPPER_4DRAM_HOLDER_OPEN)
        self.arm.move_to_locations(balance_holder_up_loc)
        self.arm.close_gripper(self.GRIPPER_4DRAM_OPEN)

        self.attempt_grip_with_retry(balance_holder_up_loc, holder_vial_in, self.GRIPPER_4DRAM_OPEN)

        self.home_arm_R()

    @tool_check_off
    def extraction_vial_holder_to_balance(self):
        """
        Moves the 4dram balance holder to the balance.
        """
        logger.debug("Moving the 4dram vial to the balance.")

        balance_holder_approach_loc = self.sequences[self.BALANCE_4DRAM_HOLDER_APPROACH]
        balance_holder_approach = self.sequences.joints[self.BALANCE_4DRAM_HOLDER_APPROACH]
        balance_holder_up = self.sequences[self.BALANCE_4DRAM_HOLDER_UP]
        balance_holder_in = self.sequences[self.BALANCE_4DRAM_HOLDER_IN]

        self.home_arm_R()
        self.arm.move_joints(balance_holder_approach)
        self.arm.move_to_locations(balance_holder_up)
        self.arm.move_to_locations(balance_holder_in.translate(z=1))
        self.arm.close_gripper(self.GRIPPER_4DRAM_HOLDER_OPEN)
        self.arm.move_to_locations(balance_holder_up)
        self.arm.move_to_locations(balance_holder_approach_loc)
        self.home_arm_R()

    @tool_check_off
    def extraction_vial_holder_from_balance(self):
        """
        Moves the 4dram balance holder from the balance.
        """
        logger.debug("Moving the 4dram vial from the balance.")

        balance_holder_approach_loc = self.sequences[self.BALANCE_4DRAM_HOLDER_APPROACH]
        balance_holder_approach = self.sequences.joints[self.BALANCE_4DRAM_HOLDER_APPROACH]
        balance_holder_up = self.sequences[self.BALANCE_4DRAM_HOLDER_UP]
        balance_holder_in = self.sequences[self.BALANCE_4DRAM_HOLDER_IN]

        self.home_arm_R()
        self.arm.move_joints(balance_holder_approach)
        self.arm.close_gripper(self.GRIPPER_4DRAM_HOLDER_OPEN)
        self.arm.move_to_locations(balance_holder_up)
        self.arm.move_to_locations(balance_holder_in)
        self.arm.close_gripper(self.GRIPPER_4DRAM_HOLDER_CLOSE)
        self.arm.move_to_locations(balance_holder_up)
        self.arm.move_to_locations(balance_holder_approach_loc)
        self.home_arm_R()

    ########################
    # Helper Functions
    ########################

    def object_detected(self, max_checks=5, delay=0.3):
        for attempt in range(max_checks):
            detected = self.arm.gripper.get_register('OBJ')
            if int(detected.decode()) == 2:
                return True
            if attempt < max_checks - 1:
                logger.debug("Object not detected on check %d/%d, retrying...", attempt + 1, max_checks)
                time.sleep(delay)
        logger.error("Error - Object pick-up not successful after %d checks", max_checks)
        return False
    
    def attempt_grip_with_retry(self, lift_pos, grip_pos, open_position, max_retries=3):
        
        self.arm.move_to_locations(lift_pos)
        
        for attempt in range(max_retries):
            self.arm.move_to_locations(grip_pos)
            self.arm.close_gripper(self.GRIPPER_CLOSE_DEFAULT)
            if self.object_detected():
                pass
            else:
                logger.error("Object not found.")
                raise ToolStateError("Object not found.")
            
            self.arm.move_to_locations(lift_pos, velocity=self.arm.default_velocity*0.4)
            if self.object_detected():
                return
            logger.debug(f"Attempt {attempt + 1} failed. Retrying...")
            self.arm.open_gripper(open_position)
        
        raise ValueError(f"Error - Object pick-up not successful after {max_retries} attempts.")


class ToolStateError(Exception):
    """Raise this error if the tool is in the wrong state to perform such a command."""
    pass
