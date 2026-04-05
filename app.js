// ==========================================
// 💡 Firebase 核心設定 (已確認金鑰大小寫完全正確)
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyA3WVaJnuHMVtmNJJ3gB4hp49ytOPnxwog",
    authDomain: "ai-video-e6675.firebaseapp.com",
    projectId: "ai-video-e6675",
    storageBucket: "ai-video-e6675.firebasestorage.app",
    messagingSenderId: "655592187282",
    appId: "1:655592187282:web:8967292f691717d407cd4b",
};

// 初始化 Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;

// ==========================================
// 會員系統核心邏輯 (Google 登入與介面解鎖)
// ==========================================
auth.onAuthStateChanged(async (user) => {
    const mainApp = document.getElementById('mainApp');
    const loginBtn = document.getElementById('loginBtn');
    const userProfile = document.getElementById('userProfile');
    const placeholderText = document.getElementById('placeholderText');

    if (user) {
        currentUser = user;
        // 更新 UI
        loginBtn.style.display = 'none';
        userProfile.style.display = 'flex';
        document.getElementById('userPhoto').src = user.photoURL;
        document.getElementById('userName').innerText = user.displayName;
        placeholderText.innerText = "等待生成中...";
        
        // 啟用功能並解鎖介面
        mainApp.style.display = 'block';
        mainApp.style.opacity = '1';
        mainApp.style.pointerEvents = 'auto';

        // 1. 從雲端抓取該會員儲存的 API Key
        await loadUserApiKey();
        // 2. 從雲端抓取該會員的生成紀錄
        await renderCloudHistory();
    } else {
        currentUser = null;
        loginBtn.style.display = 'flex';
        userProfile.style.display = 'none';
        mainApp.style.opacity = '0.5';
        mainApp.style.pointerEvents = 'none';
    }
});

async function handleGoogleLogin() {
    const provider = new firebase.auth.GoogleAuthProvider();
    try { await auth.signInWithPopup(provider); } catch (e) { alert(e.message); }
}

function handleLogout() { auth.signOut(); location.reload(); }

// 儲存金鑰到 Firestore
async function saveUserApiKey() {
    const key = document.getElementById('apiKeyInput').value.trim();
    if (!key) return alert("請輸入金鑰內容！");
    
    try {
        await db.collection('users').doc(currentUser.uid).set({
            api_key: key,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        alert("✅ 金鑰已安全儲存至雲端！");
    } catch (e) { alert("儲存失敗：" + e.message); }
}

// 讀取金鑰
async function loadUserApiKey() {
    const doc = await db.collection('users').doc(currentUser.uid).get();
    if (doc.exists && doc.data().api_key) {
        document.getElementById('apiKeyInput').value = doc.data().api_key;
    }
}

// ==========================================
// 隱形無損引擎：完整保留原圖，並以毛玻璃背景填滿至 9:16
// ==========================================
function previewImage() {
    const fileInput = document.getElementById('imageInput');
    const previewContainer = document.getElementById('imagePreview');
    
    if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        const reader = new FileReader();
        reader.onload = function(e) {
            previewContainer.innerHTML = `<img src="${e.target.result}" class="preview-img">`;
            previewContainer.style.display = 'block';
        }
        reader.readAsDataURL(file);
    }
}

function processImageTo916(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            // 設定標準 9:16 直式影片的高畫質解析度
            canvas.width = 720;
            canvas.height = 1280;
            const ctx = canvas.getContext('2d');

            const targetRatio = canvas.width / canvas.height;
            const sourceRatio = img.width / img.height;

            // --- 步驟 1：繪製毛玻璃模糊背景 ---
            let bgWidth, bgHeight, bgX, bgY;
            if (sourceRatio > targetRatio) {
                bgHeight = canvas.height;
                bgWidth = canvas.height * sourceRatio;
                bgX = (canvas.width - bgWidth) / 2;
                bgY = 0;
            } else {
                bgWidth = canvas.width;
                bgHeight = canvas.width / sourceRatio;
                bgX = 0;
                bgY = (canvas.height - bgHeight) / 2;
            }
            
            ctx.filter = 'blur(40px) brightness(0.8)';
            ctx.drawImage(img, bgX, bgY, bgWidth, bgHeight);
            ctx.filter = 'none';

            // --- 步驟 2：將原圖完整無損置中畫上去 ---
            let drawWidth, drawHeight, offsetX, offsetY;
            if (sourceRatio > targetRatio) {
                drawWidth = canvas.width;
                drawHeight = canvas.width / sourceRatio;
                offsetX = 0;
                offsetY = (canvas.height - drawHeight) / 2;
            } else {
                drawHeight = canvas.height;
                drawWidth = canvas.height * sourceRatio;
                offsetX = (canvas.width - drawWidth) / 2;
                offsetY = 0;
            }

            ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

            // 將處理好的完美 9:16 Canvas 轉回 File 物件
            canvas.toBlob((blob) => {
                if (blob) {
                    const newFile = new File([blob], "processed_image_4k.jpg", { type: "image/jpeg" });
                    resolve(newFile);
                } else {
                    reject(new Error("圖片處理失敗"));
                }
            }, 'image/jpeg', 0.95);
        };
        img.onerror = () => reject(new Error("圖片載入失敗"));
        img.src = URL.createObjectURL(file);
    });
}

// ==========================================
// 核心生成與 API 輪詢邏輯
// ==========================================
async function startVideoGeneration() {
    const apiKey = document.getElementById('apiKeyInput').value.trim();
    const fileInput = document.getElementById('imageInput');
    const promptInput = document.getElementById('promptInput').value.trim();
    const durationInput = document.getElementById('durationInput').value;

    if (!apiKey) return alert("請先填寫並儲存 API 金鑰！");
    if (fileInput.files.length === 0) return alert("請上傳圖片！");
    if (!promptInput) return alert("請輸入提示詞！");

    const btn = document.getElementById('generateBtn');
    const statusText = document.getElementById('statusText');
    const videoContainer = document.getElementById('videoContainer');
    const placeholder = document.getElementById('placeholder');

    btn.disabled = true;
    btn.innerText = "⏳ 魔法施展中，請勿關閉網頁...";
    statusText.innerText = "正在為您的圖片加入無損毛玻璃背景 (自動轉為 9:16)...";
    videoContainer.style.display = 'none';
    placeholder.style.display = 'block';

    try {
        const processedFile = await processImageTo916(fileInput.files[0]);
        const formData = new FormData();
        formData.append("api_key", apiKey);
        formData.append("image", processedFile);
        formData.append("prompt", promptInput);
        formData.append("duration", durationInput);

        statusText.innerText = `上傳任務至伺服器中 (${durationInput} 秒模式)...`;
        
        const res = await fetch("/api/generate_video", { method: "POST", body: formData });
        const responseText = await res.text();
        
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (jsonError) {
            throw new Error(`伺服器異常 (狀態碼: ${res.status}): ${responseText.substring(0, 80)}...`);
        }

        if (!res.ok) {
            let errorMsg = data.detail;
            if (Array.isArray(errorMsg)) {
                errorMsg = "欄位驗證失敗: " + errorMsg.map(e => e.msg).join(', ');
            } else if (typeof errorMsg === 'object') {
                errorMsg = JSON.stringify(errorMsg, null, 2);
            }
            throw new Error(errorMsg || "未知錯誤");
        }

        if (data.task_id) {
            statusText.innerText = "✅ 任務已啟動！AI 正在進行算圖，約需 2~5 分鐘...";
            pollStatus(data.task_id, apiKey, promptInput, durationInput);
        } else { throw new Error(data.detail || "失敗"); }
    } catch (error) {
        statusText.innerText = `❌ 錯誤：${error.message}`;
        btn.disabled = false;
        btn.innerText = "🚀 立即生成影片";
    }
}

function pollStatus(taskId, apiKey, promptText, durationVal) {
    const btn = document.getElementById('generateBtn');
    const statusText = document.getElementById('statusText');
    const videoContainer = document.getElementById('videoContainer');
    const placeholder = document.getElementById('placeholder');
    const resultVideo = document.getElementById('resultVideo');
    const downloadBtn = document.getElementById('downloadBtn');
    
    let dotCount = 0;

    const interval = setInterval(async () => {
        try {
            dotCount = (dotCount + 1) % 4;
            const dots = ".".repeat(dotCount);
            statusText.innerText = `🎬 影片渲染中 (高畫質 720p / ${durationVal}秒)，請耐心等候${dots}`;
            
            const res = await fetch(`/api/status/${taskId}?api_key=${encodeURIComponent(apiKey)}`);
            const text = await res.text();
            
            let data;
            try { data = JSON.parse(text); } catch (e) { return; }

            if (data.status === "completed") {
                clearInterval(interval);
                statusText.innerText = "🎉 生成完成！";
                
                resultVideo.src = data.video_url;
                downloadBtn.href = `/api/download_video?url=${encodeURIComponent(data.video_url)}`;
                placeholder.style.display = 'none';
                videoContainer.style.display = 'flex';
                
                // 成功後，將資料寫入 Firestore 雲端資料庫
                saveToCloudHistory(data.video_url, promptText, durationVal);
                
                btn.disabled = false;
                btn.innerText = "✨ 再做一部影片";

            } else if (data.status === "failed") {
                clearInterval(interval);
                statusText.innerText = `❌ 生成失敗：${data.detail}`;
                btn.disabled = false;
                btn.innerText = "🚀 重新嘗試";
            }
        } catch (e) { console.log("輪詢暫時中斷，等待下次重試..."); }
    }, 8000);
}

// ==========================================
// 雲端歷史紀錄引擎 (Firestore) - 無敵解鎖版
// ==========================================
async function saveToCloudHistory(url, prompt, duration) {
    try {
        await db.collection('history').add({
            uid: currentUser.uid,
            url: url,
            prompt: prompt,
            duration: duration,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        renderCloudHistory(); // 重新渲染畫面
    } catch (e) {
        console.error("歷史紀錄寫入雲端失敗: ", e);
    }
}

async function renderCloudHistory() {
    const grid = document.getElementById('historyGrid');
    
    try {
        // 💡 破解法：移除 orderBy，避開 Firebase 嚴格的複合索引要求
        const snapshot = await db.collection('history')
            .where('uid', '==', currentUser.uid)
            .get();

        if (snapshot.empty) {
            grid.innerHTML = '<p style="text-align:center; color:#999; grid-column: 1/-1; padding: 30px;">尚無紀錄！趕緊生成您的第一部雲端影片吧！</p>';
            return;
        }

        // 💡 破解法：資料拿回來後，交給瀏覽器在前端進行時間排序
        let historyData = snapshot.docs.map(doc => doc.data());
        historyData.sort((a, b) => {
            const timeA = a.createdAt ? a.createdAt.toMillis() : 0;
            const timeB = b.createdAt ? b.createdAt.toMillis() : 0;
            return timeB - timeA; // 新的在前面
        });
        
        // 只顯示最新 20 筆
        historyData = historyData.slice(0, 20);

        grid.innerHTML = historyData.map(item => {
            const time = item.createdAt ? item.createdAt.toDate().toLocaleString('zh-TW', { hour12: false }) : '剛剛';
            return `
                <div class="history-card">
                    <video class="history-video" src="${item.url}" controls playsinline preload="metadata"></video>
                    <div class="history-info">
                        <strong>${item.prompt}</strong>
                        <span>⏱️ ${item.duration} 秒 | 📅 ${time}</span>
                    </div>
                    <a class="history-action" href="/api/download_video?url=${encodeURIComponent(item.url)}" target="_blank">💾 點擊下載</a>
                </div>
            `;
        }).join('');
    } catch (e) {
        console.error("無法讀取歷史紀錄: ", e);
        // 如果是權限沒開好，這裡會直接顯示紅字提醒您
        grid.innerHTML = `<p style="text-align:center; color:red; grid-column: 1/-1; padding: 30px;">讀取失敗：${e.message}</p>`;
    }
}