const fs = require('fs');
const { XacroLoader } = require('urdf-loader/src/XacroLoader');
// Wait, DOMParser is not available in node.js without xmldom
// I will just construct the URDF manually in python since I have roboticstoolbox installed in /tmp/rtb_venv!
