---
description: How to run the Profile Maker as a desktop application
---

To run the application as a desktop app without opening a web browser:

1. **Development Mode**:
   Run the following commands in separate terminals to start the app and the profile service:
   ```powershell
   # Start the Profile Service (API)
   npm run server
   ```
   ```powershell
   # Start the Desktop App
   npm run electron:dev
   ```

2. **Build Portable App**:
   To create a standalone, portable Windows executable (`.exe`):
   ```powershell
   npm run electron:build
   ```
   The executable will be generated in the `dist-electron` folder.

3. **Running the Built App**:
   Once built, you can find `Profile Maker.exe` in `dist-electron` and run it directly.

4. **Running a Dedicated Hosting Node (Relay)**:
   If you want to host your own P2P dedicated node to ensure your profiles are always online:
   
   - **Desktop Node**: 
     ```powershell
     npm run hosting:desktop
     ```
   - **Railway Node**: 
     Deploy this repository to Railway and set the start command to:
     ```powershell
     npm run hosting:railway
     ```
