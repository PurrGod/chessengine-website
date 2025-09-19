# Full-Stack Chess Application with UCI Engine

This project is a complete, full-stack web application that allows users to play chess against a custom-built, high-performance chess engine. It also supports engine-vs-engine gameplay, detailed position analysis, and flexible time controls.

The entire system is designed with a clean separation of concerns: a performant C-based chess engine, a robust Node.js backend to manage it, and a dynamic vanilla JavaScript frontend for a seamless user experience.

## Table of Contents

- [Features](#features)
- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Setup and Installation](#setup-and-installation)
- [How It Works](#how-it-works)
- [Adding a New Engine](#adding-a-new-engine)

## Features

- **Human vs. Engine Gameplay**: Play chess against any of the provided engine versions.
- **Engine vs. Engine Simulation**: Pit different chess engines against each other to analyze their performance.
- **Multiple Engine Support**: Easily add new UCI-compliant engine executables to the `engine/` directory to make them available for gameplay.
- **Flexible Time Controls**: Configure games with various base times and increments (e.g., 5+2, 10+0).
- **Real-time Evaluation Bar**: An optional evaluation bar shows the engine's assessment of the current position in real-time.
- **Move History & Game Tools**: View the full game history in SAN format, and easily copy the current position (FEN) or the full game (PGN).
- **Independent Position Analysis**: Paste any FEN into the analysis tool to get an immediate best move and evaluation from the engine.
- **Responsive UI**: The interface is designed to work smoothly on various screen sizes.

## Architecture Overview

The application is built on a three-tier architecture that clearly separates the client, server, and engine logic.

### Frontend (Client)

- A static web interface built with HTML, CSS, and vanilla JavaScript.
- It handles all user interactions, renders the chessboard using chessboard.js, and communicates with the backend via a REST API.
- It does not contain any chess logic; it only displays the state provided by the server.

### Backend (Server)

- A Node.js server using the Express.js framework.
- It serves the frontend files and exposes API endpoints for making moves and analyzing positions.
- Its primary role is to act as a bridge between the web client and the C chess engine.

### Chess Engine

- A high-performance chess engine written in C.
- It runs as a separate executable and communicates using the standard Universal Chess Interface (UCI) protocol.
- The Node.js backend launches this executable as a child process and communicates with it by writing to its stdin and reading from its stdout.

## Tech Stack

| Category | Technology |
|----------|------------|
| Frontend | HTML5, CSS3, Vanilla JavaScript, jQuery (for chessboard.js), chessboard.js |
| Backend | Node.js, Express.js |
| Engine | C, GCC / Make for compilation |
| Protocol | REST API (Frontend ↔ Backend), UCI Protocol via stdin/stdout streams (Backend ↔ Engine) |
| Dev Tools | npm, Git |

## Setup and Installation

Follow these steps to get the application running on your local machine.

### Prerequisites

- **Node.js** (version 18.x or higher recommended)
- **npm** (usually included with Node.js)
- **A C compiler** (like gcc) and make build tools.
  - On Debian/Ubuntu: `sudo apt-get install build-essential`
  - On macOS: Install Xcode Command Line Tools (`xcode-select --install`)
  - On Windows: Use WSL (Windows Subsystem for Linux) with the build-essential package.

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/your-repo-name.git
cd your-repo-name
```

### 2. Install Dependencies

Install the Node.js packages required for the server.

```bash
npm install
```

This command also runs the postinstall script in package.json, which makes the engine executables runnable (`chmod +x`).

### 3. Compile the C Engine (if needed)

The repository includes a pre-compiled `chess_engine` executable. If you make changes to the C source code (not included in this project, but assuming you have it), you would need to recompile it. For example:

```bash
# Navigate to the C source directory
# cd engine_source/

# Compile the engine
make
# or
# gcc -o ../engine/chess_engine main.c -O3
```

### 4. Run the Server

Start the Node.js server.

```bash
npm start
```

The application should now be running at http://localhost:3001.

## How It Works

The core of this project is the communication between the Node.js backend and the C engine.

1. A user makes a move on the frontend. The frontend sends the current board state (as a FEN string) to the `/api/make-move` endpoint on the Node.js server.

2. The Node.js server receives the request and spawns the C `chess_engine` executable as a child process using Node's `child_process` module.

3. The server writes UCI commands to the engine's stdin stream, such as:
   - `position fen rnbqkbnr/...` to set up the board.
   - `go movetime 1000` to tell the engine to think for 1 second.

4. The engine processes these commands and begins writing its analysis and final best move to its stdout stream.

5. The Node.js server listens to the engine's stdout stream, parsing the output to find the `bestmove ...` line.

6. Once the best move is found, the server sends it back to the frontend as the API response.

7. The frontend receives the move, updates the board, and the cycle continues.

## Adding a New Engine

This application is designed to work with any standard UCI-compliant chess engine.

1. Compile your chess engine into a single executable file.
2. Place the executable inside the `/engine` directory.
3. Restart the server.

The application will automatically detect the new file and add it as an option in the "White" and "Black" player dropdowns on the website.