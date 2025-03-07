const fs = require("fs");
// const { chunk } = require("lodash");
const ws = require("ws");
const path = require("path");

// const LOG_FILE_PATH = "/home/ubuntu/browserstack/logs.txt";
const LOG_FILE_PATH = path.join(__dirname, "logs.txt"); //absolute file path for now we are using local.
const PORT = 8080;
const BUFFER_SIZE = 64 * 1024;
let lastFileSize = 0;
let debounceTimeout;

// a arrow method to get the n recent lines a helper method
const getNRecentLines = (filePath, n) => {
  return new Promise((resolve, reject) => {
    fs.open(filePath, "r", n, (err, fd) => {
      if (err) {
        fd.close(fd, () => {});
        return reject(err);
      }

      const buffer = Buffer.alloc(BUFFER_SIZE);
      let lines = [];
      let leftover = ""; // For holding lefover data that don't for a full line.
      let fileSize;

      fs.fstat(fd, (err, stat) => {
        if (err) {
          fd.close(fd, () => {});
          return reject(err);
        }

        fileSize = stat.size;

        let position = fileSize;

        const readFile = () => {
          // method to read the file
          const bytesAhead = Math.min(position, BUFFER_SIZE);
          const start = position - bytesAhead;

          if (bytesAhead <= 0) {
            if (leftover) {
              lines.unshift(leftover);
            }
            fs.close(fd, () => {});
            resolve(lines.slice(-n));
            return;
          }

          fs.read(fd, buffer, 0, bytesAhead, start, (err, reader) => {
            if (err) {
              fs.close(fd, () => {});
              return reject(err);
            }

            position = position - bytesAhead;
            const chunk = buffer.toString("utf-8", 0, bytesAhead);
            const chunkLine = (chunk + leftover).split("\n");

            leftover = chunkLine.shift();

            lines = chunkLine.concat(lines);

            if (lines.length >= n) {
              fs.close(fd, () => {});
              resolve(lines.slice(-n));
              return;
            }

            readFile();
          });
        };
        readFile();
      });
    });
  });
};

// get the most recent lines for a client based on it's last posision.
const getRecentLines = (filePath, fromPosition) => {
  return new Promise((resolve, reject) => {
    const streamOptions = { encoding: "utf-8", start: fromPosition };
    const st = fs.createReadStream(filePath, streamOptions);

    let data = "";

    st.on("data", (chunk) => (data += chunk));

    st.on("end", () => {
      const lines = data.split("\n").filter((line) => line.trim());
      resolve(lines);
    });

    st.on("error", reject);
  });
};

const socket = new ws.WebSocket.Server({ port: PORT }, () => {
  console.log("ws is started at ws://localhost:" + PORT);
});

socket.on("connection", (ws) => {
  console.log("Client is connected");

  getNRecentLines(LOG_FILE_PATH, 10)
    .then((lines) => {
      ws.send(JSON.stringify({ lines }));
    })
    .catch((error) => {
      console.error("Error reading file", error);
      ws.send(JSON.stringify({ error: "Unable to read the file" }));
    });

  socket.on("close", () => {
    console.log("Client is disconnected from the socket");
  });
});

fs.watch(LOG_FILE_PATH, async (event) => {
  if (event === "change") {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(async () => {
      try {
        const stats = await fs.promises.stat(LOG_FILE_PATH);
        if (stats.size > lastFileSize) {
          const newL = await getRecentLines(LOG_FILE_PATH, lastFileSize);
          lastFileSize = stats.size;
          socket.clients.forEach((client) => {
            if (client.readyState === 1) {
              // 1 is for ws open
              client.send(JSON.stringify({ lines: newL }));
            }
          });
        }
      } catch (err) {
        console.log("Error retriving file stats while watching the file", err);
      }
    }, 100);
  }
});

fs.promises
  .stat(LOG_FILE_PATH)
  .then((stat) => {
    lastFileSize = stat.size;
  })
  .catch(() => {
    console.log("Error could not get fiel stats");
    lastFileSize = 0;
  });
