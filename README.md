# Universal Robot Arm Visualizer & Script Helper

A web-based interactive tool built with React and Three.js to parse Universal Robot `.script` files and visualize arm trajectories natively in the browser. It allows engineers to load UR3, UR5, or UR10 models, extract waypoints, and preview simulated robotic paths interactively without requiring heavy ROS installations or local dependencies.

## Key Features

- **Real-Time 3D Rendering**: High-performance browser-based visualization of URDF models using Three.js and React Three Fiber.
- **Dynamic `.script` Parsing**: Instantly uploads and parses raw URScript files, extracting `movej` and `movel` sequences.
- **Interactive Trajectories**: Visualizes the path segments the robot will take between parsed points, complete with selectable segments.
- **TCP Orientation Indicators**: A glowing cyan indicator attached to the tool flange (`tool0`) visually confirms the exact Z-axis rotation and orientation of the end-effector at each point.
- **Clean Aesthetic UI**: Built with a custom glassmorphism design system supporting dynamic Light and Dark modes.
- **Zero-Bloat Repository**: 3D mesh files are completely externalized to a CDN to keep the Git repository incredibly lightweight.

## Architecture & Dependencies

This project relies on a modern frontend stack to handle complex 3D math and UI rendering:

- **React 19 & TypeScript**: Core application framework.
- **Vite**: Ultra-fast build tool and development server.
- **Three.js & @react-three/fiber**: The foundation for rendering the 3D canvas and interacting with the scene graph using React components.
- **urdf-loader**: A specialized loader that parses standard XML `.urdf` robot descriptions.
- **Lucide React**: Scalable SVG icons for the user interface.

### 3D Mesh Strategy (CDN Integration)
A standard Universal Robot URDF requires dozens of high-quality `.dae` (Collada) and `.stl` mesh files for collision and visual geometries, usually totaling over 100MB. 

To avoid bloating this Git repository with heavy 3D assets, this project implements a highly optimized CDN strategy. The core `urdf-loader` is configured to intercept `package://ur_description` URLs and dynamically fetch the physical 3D meshes over the network from the official `ros-industrial/universal_robot` repository using the **jsDelivr CDN**. 

Because of this, the repository only needs to store the tiny text-based `.urdf` files (`ur3.urdf`, `ur5.urdf`, `ur10.urdf`) in the `public/` directory!

## Local Development

To run this project locally, ensure you have Node.js installed, then execute:

```bash
# Install dependencies
npm install

# Start the local development server
npm run dev
```

## Production Build & Deployment

The application is fully configured as a Single-Page Application (SPA) and is ready for production.

```bash
# Create an optimized production build in the /dist folder
npm run build
```

### Vercel Deployment
This project is configured for seamless deployment to Vercel. 
1. Push the code to a GitHub repository.
2. Connect the repository in your Vercel Dashboard.
3. Deploy! Vercel will automatically detect the Vite framework and build the project. 

*Note: A `vercel.json` file is included in the root to ensure proper routing rewrites for the SPA.*
