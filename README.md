# Tagisan Quiz Show Buzzer

---

## 🛠️ Features
* **Backend:** Node.js & Socket.io for real-time, synchronized state management.
* **Host Panel (`host.html`):** controls rounds, scores, question states, and evaluations.
* **Player Buzzer (`player.html`):** buzzer with automatic lockout, haptic vibration, and local audio feedback.
* **Spectator Display (`spectator.html`):** evenly split columnar layout for up to 5 teams, instant green-glow highlights for the first buzzer.

---

## 📂 Project Structure

```text
tagisan-buzzer/
├── server.js            # Express & Socket.io server logic
├── index.html           # Main menu / selection
├── host.html            # Host control dashboard
├── player.html          # Participant buzzer interface
├── spectator.html       # Quiz master / projector display view
├── schools.txt          # School list for dropdown
└── assets/
    └── logos/           # School logos
    └── sounds/          # SFX
```

## ⚙️ Setup & Installation

1. Prerequisites
```
Make sure you have Node.js installed on your computer.
```

Run the following in your terminal to check if successfully installed:

```bash
node -v
```

2. Initialize and Install Dependencies

Open your terminal inside the project folder and run:

```Bash

npm init -y
npm install express socket.io
```
3. Start the Server

Launch the Node backend:
```Bash

node server.js
```
The server will start running at http://localhost:3000.


## 🎮 How to Operate or Run

* **Host Computer:**
```html
http://localhost:3000/host.html
```

For the following, you need to connect via your local network IP

* **Projector Display and Quiz Masters:**
```html
http://<YOUR_IP>:3000/spectator.html

e.g. http://192.168.100.62:3000/spectator.html
```

* **Players:**

```html
http://<YOUR_IP>:3000/player.html 

e.g. http://192.168.100.62:3000/player.html
```

#### 🔍 How to find your Host Computer's Local IP Address:

Open your terminal on the host computer and run:

```bash
ipconfig
```

Look for something like this:

```
Wireless LAN adapter Wi-Fi:

   ...
   IPv4 Address. . . . . . . . . . . : 192.168.100.62
   ...
```

---

### ⚠️ Compatibility Notes (iOS / Apple Devices)

If players or spectators are using **iPhones or iPads (iOS Safari)**, please note the following platform limitations:
* **Haptic Vibration:** The Web Vibration API (`navigator.vibrate`) is **not supported by iOS Safari** due to Apple's system restrictions. Players on iPhones will still get visual feedback, sounds, and full functionality, but the physical vibration pulse will not trigger.
* **Audio Players:** Audio works normally after the user interacts with the page (tapping the big buzzer button for the first time unlocks the audio context).