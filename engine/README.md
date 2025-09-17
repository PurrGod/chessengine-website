# Chess Engines

This directory contains the chess engine executables used by the web application.

## Adding a New Engine

To add a new engine, simply place the compiled, executable file in this directory. The server will automatically detect it and make it available in the engine selection dropdowns on the website.

**Important:**

* The engine must be a UCI-compliant chess engine.
* The file must be an executable that can be run on the server's operating system.
* The filename will be used as the engine's name in the UI, so choose a descriptive name.