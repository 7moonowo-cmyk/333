// 遠端攝影機與手勢偵測
// 電腦開啟：顯示 QR Code 等待連線
// 手機掃描：傳送攝影機畫面，並由電腦進行 ml5 運算

let video;
let handPose;
let hands = [];
let peer;
let myId;
let isHost = true; // 判斷是接收端(電腦)還是傳送端(手機)
let qrImage;
let statusText = "正在初始化連線...";

// 特效與布局變數
let headerHeight = 80;
let bubbles = [];
const fingerConnections = [
  [0, 1, 2, 3, 4],       // 拇指
  [5, 6, 7, 8],          // 食指
  [9, 10, 11, 12],       // 中指
  [13, 14, 15, 16],      // 無名指
  [17, 18, 19, 20],      // 小指
  [0, 5, 9, 13, 17, 0]   // 掌心基部
];

class Bubble {
  constructor(x, y) {
    this.pos = createVector(x, y);
    this.vel = createVector(random(-1, 1), random(-2, -5));
    this.size = random(10, 20);
    this.life = 255;
  }
  run() {
    this.pos.add(this.vel);
    this.life -= 5;
    noStroke();
    fill(200, 230, 255, this.life * 0.6);
    circle(this.pos.x, this.pos.y, this.size);
    stroke(255, this.life);
    noFill();
    circle(this.pos.x, this.pos.y, this.size);
  }
}

function preload() {
  // 初始化手勢偵測模型
  handPose = ml5.handPose({ flipped: false }); // 關閉模型翻轉，由我們手動控制鏡像
}

function setup() {
  createCanvas(windowWidth, windowHeight);

  // 檢查 URL 是否有 hash (例如 #targetID)，有的話就是傳送端
  let hash = window.location.hash;
  if (hash && hash.length > 1) {
    isHost = false;
    let targetId = hash.substring(1);
    setupSender(targetId);
  } else {
    isHost = true;
    setupHost();
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function setupHost() {
  // 1. 初始化 PeerJS
  peer = new Peer();
  
  peer.on('open', (id) => {
    myId = id;
    // 產生 QR Code 連結 (將當前網址加上 ID)
    let url = window.location.href.split('#')[0] + "#" + myId;
    qrImage = loadImage(`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`);
    statusText = "請用手機掃描 QR Code 以連接相機";
    console.log("主機已就緒，等待 ID:", myId);
  });

  // 2. 當接收到手機傳來的影像時
  peer.on('call', (call) => {
    call.answer(); // 接聽，不需回傳本地影像
    call.on('stream', (remoteStream) => {
      // 將遠端 WebRTC 串流轉為 p5 video
      video = createVideo('');
      video.elt.srcObject = remoteStream;
      video.elt.muted = true;
      video.elt.play();
      video.hide();
      
      // 開始對遠端串流進行偵測
      handPose.detectStart(video, gotHands);
      statusText = "已連接遠端相機";
    });
  });
}

function setupSender(targetId) {
  // 手機端：啟動相機並呼叫電腦
  video = createCapture(VIDEO); // 手機端直接啟動
  video.size(640, 480);
  video.hide(); 

  peer = new Peer();
  peer.on('open', () => {
    // 檢查相機是否有串流
    let checkInterval = setInterval(() => {
      if (video.elt.srcObject) {
        peer.call(targetId, video.elt.srcObject);
        clearInterval(checkInterval);
        statusText = "影像傳送中，請查看電腦畫面";
      }
    }, 500);
  });
}

function gotHands(results) {
  hands = results;
}

function draw() {
  background(0);

  if (video && video.elt.srcObject) {
    if (isHost && video.elt.videoWidth > 0) {
      // 1. 計算 Aspect Fit 等比例縮放與置中偏移
      let screenW = width;
      let screenH = height - headerHeight;
      let videoW = video.elt.videoWidth;
      let videoH = video.elt.videoHeight;

      let s = min(screenW / videoW, screenH / videoH);
      let drawW = videoW * s;
      let drawH = videoH * s;
      let xOff = (screenW - drawW) / 2;
      let yOff = headerHeight + (screenH - drawH) / 2;

      // 2. 進入鏡像模式 (水平翻轉)
      push();
      translate(width, 0); 
      scale(-1, 1);

      // 繪製影片 (在鏡像座標系中)
      image(video, xOff, yOff, drawW, drawH);

      // 3. 處理與繪製手勢
      for (let hand of hands) {
        if (hand.confidence > 0.1) {
          let col = (hand.handedness === "Left") ? color(255, 0, 255) : color(255, 255, 0);
          
          // 繪製骨架連接線
          stroke(col);
          strokeWeight(4);
          for (let conn of fingerConnections) {
            for (let i = 0; i < conn.length - 1; i++) {
              let p1 = hand.keypoints[conn[i]];
              let p2 = hand.keypoints[conn[i+1]];
              if (p1 && p2) {
                line(p1.x * s + xOff, p1.y * s + yOff, p2.x * s + xOff, p2.y * s + yOff);
              }
            }
          }

          // 繪製指關節點 (加大標點)
          noStroke();
          fill(col);
          for (let keypoint of hand.keypoints) {
            circle(keypoint.x * s + xOff, keypoint.y * s + yOff, 18);
          }

          // 產生指尖泡泡 (4, 8, 12, 16, 20 是五指尖)
          [4, 8, 12, 16, 20].forEach(idx => {
            let tip = hand.keypoints[idx];
            if (tip) {
              bubbles.push(new Bubble(tip.x * s + xOff, tip.y * s + yOff));
            }
          });
        }
      }

      // 更新並顯示泡泡
      for (let i = bubbles.length - 1; i >= 0; i--) {
        bubbles[i].run();
        if (bubbles[i].life <= 0) bubbles.splice(i, 1);
      }
      if (bubbles.length > 300) bubbles.splice(0, 10);
      
      pop(); // 退出鏡像模式
    }
  }

  // 介面顯示
  fill(255);
  textAlign(CENTER, CENTER);

  // 繪製標題 (不翻轉)
  textSize(32);
  textStyle(BOLD);
  textAlign(LEFT, CENTER);
  text("414730332紀XX", 30, headerHeight / 2);
  textAlign(CENTER, CENTER);

  // 如果是主機端，且還在載入中（沒影像也沒 QR Code）
  if (isHost && !video && !qrImage) {
    textSize(32); // 更顯眼的文字大小
    text(statusText, width / 2, height / 2);
  } else {
    textSize(16); // 一般狀態的文字大小
    text(statusText, width / 2, height - 30);
    if (isHost && qrImage && !video) {
      imageMode(CENTER);
      image(qrImage, width / 2, height / 2, 200, 200);
      imageMode(CORNER);
    }
  }
}
