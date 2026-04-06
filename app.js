// ==========================================
// 💡 Firebase 核心設定
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
// 👤 會員系統核心邏輯 (Google 登入與介面解鎖)
// ==========================================
auth.onAuthStateChanged(async (user) => {
    const mainApp = document.getElementById('mainApp');
    const loginBtn = document.getElementById('loginBtn');
    const userProfile = document.getElementById('userProfile');
    const placeholderText = document.getElementById('placeholderText');

    if (user) {
        currentUser = user;
        // 更新 UI，顯示會員資訊
        loginBtn.style.display = 'none';
        userProfile.style.display = 'flex';
        document.getElementById('userPhoto').src = user.photoURL;
        document.getElementById('userName').innerText = user.displayName;
        placeholderText.innerText = "等待生成中...";
        
        // 啟用功能並解鎖介面
        mainApp.style.display = 'block';
        mainApp.style.opacity = '1';
        mainApp.style.pointerEvents = 'auto';

        // 從雲端載入資料
        await loadUserApiKey();
        await renderCloudHistory();
    } else {
        currentUser = null;
        // 鎖定介面
        loginBtn.style.display = 'flex';
        userProfile.style.display = 'none';
        mainApp.style.opacity = '0.5';
        mainApp.style.pointerEvents = 'none';
    }
});

async function handleGoogleLogin() {
    const provider = new firebase.auth.GoogleAuthProvider();
    try { 
        await auth.signInWithPopup(provider); 
    } catch (e) { 
        alert(e.message); 
    }
}

function handleLogout() { 
    auth.signOut(); 
    location.reload(); 
}

// ==========================================
// 🔑 金鑰儲存與讀取系統
// ==========================================
async function saveUserApiKey() {
    const key = document.getElementById('apiKeyInput').value.trim();
    if (!key) return alert("請輸入金鑰！");
    
    try {
        await db.collection('users').doc(currentUser.uid).set({
            api_key: key,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        alert("✅ 金鑰已安全儲存！");
    } catch (e) { 
        alert("儲存失敗：" + e.message); 
    }
}

async function loadUserApiKey() {
    const doc = await db.collection('users').doc(currentUser.uid).get();
    if (doc.exists && doc.data().api_key) {
        document.getElementById('apiKeyInput').value = doc.data().api_key;
    }
}

// ==========================================
// 🤖 模型連動與 UI 控制
// ==========================================
function handleModelChange() {
    const model = document.getElementById('modelSelect').value;
    const generateBtn = document.getElementById('generateBtn');
    
    // 根據選擇的模型，動態改變按鈕上的文字
    if (model === 'sora2') {
        generateBtn.innerText = "🚀 立即以 Sora 2 生成影片";
    } else {
        generateBtn.innerText = "🚀 立即以 Grok 生成影片";
    }
}

// ==========================================
// 🖼️ 隱形無損引擎：完整保留原圖，並以毛玻璃背景填滿至 9:16
// ==========================================
function previewImage() {
    const fileInput = document.getElementById('imageInput');
    const previewContainer = document.getElementById('imagePreview');
    
    if (fileInput.files.length > 0) {
        const reader = new FileReader();
        reader.onload = function(e) {
            previewContainer.innerHTML = `<img src="${e.target.result}" class="preview-img">`;
            previewContainer.style.display = 'block';
        }
        reader.readAsDataURL(fileInput.files[0]);
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
                resolve(new File([blob], "processed.jpg", { type: "image/jpeg" }));
            }, 'image/jpeg', 0.95);
        };
        img.onerror = () => reject(new Error("圖片載入失敗"));
        img.src = URL.createObjectURL(file);
    });
}

// ==========================================
// 🚀 核心生成邏輯 (發送請求至後端)
// ==========================================
async function startVideoGeneration() {
    const apiKey = document.getElementById('apiKeyInput').value.trim();
    const modelSelect = document.getElementById('modelSelect').value;
    const fileInput = document.getElementById('imageInput');
    const promptInput = document.getElementById('promptInput').value.trim();
    const durationInput = document.getElementById('durationInput').value;

    // 基本防呆檢查
    if (!apiKey) return alert("請先填寫 API 金鑰！");
    if (!promptInput) return alert("請輸入提示詞！");

    const btn = document.getElementById('generateBtn');
    const statusText = document.getElementById('statusText');
    const videoContainer = document.getElementById('videoContainer');
    const placeholder = document.getElementById('placeholder');

    // 鎖定按鈕，顯示載入狀態
    btn.disabled = true;
    btn.innerText = "⏳ 魔法施展中...";
    statusText.innerText = `正在為 ${modelSelect.toUpperCase()} 準備包裹資料...`;
    videoContainer.style.display = 'none';
    placeholder.style.display = 'block';

    try {
        const formData = new FormData();
        formData.append("api_key", apiKey);
        formData.append("prompt", promptInput);
        formData.append("duration", durationInput);
        formData.append("model_type", modelSelect);

        // 如果用戶有上傳圖片，則進行毛玻璃運算並加入表單
        if (fileInput.files.length > 0) {
            statusText.innerText = "正在處理圖片並上傳至伺服器...";
            const processedFile = await processImageTo916(fileInput.files[0]);
            formData.append("image", processedFile);
        }

        // 發送請求至我們自己的後端 (main.py)
        const res = await fetch("/api/generate_video", { 
            method: "POST", 
            body: formData 
        });
        
        const data = await res.json();

        // 錯誤處理
        if (!res.ok) {
            throw new Error(data.detail || "未知錯誤");
        }

        // 如果成功取得任務 ID，開始輪詢進度
        if (data.task_id) {
            statusText.innerText = "✅ 任務已啟動！AI 正在進行算圖...";
            pollStatus(data.task_id, apiKey, promptInput, durationInput, modelSelect);
        } else { 
            throw new Error("任務建立失敗"); 
        }

    } catch (error) {
        statusText.innerText = `❌ 錯誤：${error.message}`;
        btn.disabled = false;
        handleModelChange(); // 恢復原始按鈕文字
    }
}

// ==========================================
// 🔍 API 輪詢邏輯 (加入超時防爆機制)
// ==========================================
function pollStatus(taskId, apiKey, promptText, durationVal, modelName) {
    const btn = document.getElementById('generateBtn');
    const statusText = document.getElementById('statusText');
    const videoContainer = document.getElementById('videoContainer');
    const placeholder = document.getElementById('placeholder');
    const resultVideo = document.getElementById('resultVideo');
    const downloadBtn = document.getElementById('downloadBtn');
    
    let dotCount = 0;
    let pollCount = 0; // 💡 優化：紀錄查詢次數
    const MAX_POLLS = 75; // 💡 優化：最多查詢 75 次 (約 10 分鐘)，超時自動放棄
    
    const interval = setInterval(async () => {
        try {
            pollCount++;
            
            // 💡 優化：超時防爆保護
            if (pollCount > MAX_POLLS) {
                clearInterval(interval);
                statusText.innerText = "❌ 處理超時：AI 伺服器遲遲未回應，請稍後再試。";
                btn.disabled = false;
                handleModelChange();
                return;
            }

            // 讓畫面上的點點動起來，表示系統活著
            dotCount = (dotCount + 1) % 4;
            statusText.innerText = `🎬 ${modelName.toUpperCase()} 渲染中，請耐心等候${".".repeat(dotCount)}`;
            
            // 詢問後端目前狀態
            const res = await fetch(`/api/status/${taskId}?api_key=${encodeURIComponent(apiKey)}`);
            const data = await res.json();

            // 如果成功完成
            if (data.status === "completed") {
                clearInterval(interval);
                statusText.innerText = "🎉 生成完成！";
                
                // 顯示影片與下載按鈕
                resultVideo.src = data.video_url;
                downloadBtn.href = `/api/download_video?url=${encodeURIComponent(data.video_url)}`;
                placeholder.style.display = 'none';
                videoContainer.style.display = 'flex';
                
                // 儲存至雲端歷史紀錄
                saveToCloudHistory(data.video_url, `[${modelName.toUpperCase()}] ${promptText}`, durationVal);
                
                // 恢復按鈕狀態
                btn.disabled = false;
                handleModelChange();
                
            // 如果生成失敗
            } else if (data.status === "failed") {
                clearInterval(interval);
                statusText.innerText = `❌ 生成失敗：${data.detail}`;
                btn.disabled = false;
                handleModelChange();
            }
            // 如果還在 processing，就什麼都不做，等待下一次迴圈
            
        } catch (e) { 
            console.log("網路暫時中斷，等待下次重試..."); 
        }
    }, 8000); // 8 秒執行一次
}

// ==========================================
// 🕒 雲端歷史紀錄引擎 (Firestore)
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
        // 儲存完畢後，重新讀取並渲染畫面
        renderCloudHistory();
    } catch (e) { 
        console.error("寫入歷史紀錄失敗", e); 
    }
}

async function renderCloudHistory() {
    const grid = document.getElementById('historyGrid');
    try {
        // 從資料庫抓取屬於該用戶的所有紀錄
        const snapshot = await db.collection('history')
            .where('uid', '==', currentUser.uid)
            .get();
            
        if (snapshot.empty) { 
            grid.innerHTML = '<p style="text-align:center; color:#999; grid-column:1/-1; padding:30px;">尚無紀錄！趕緊生成您的第一部雲端影片吧！</p>'; 
            return; 
        }
        
        // 將資料轉為陣列，並在前端進行時間新舊排序
        let historyData = snapshot.docs.map(doc => doc.data());
        historyData.sort((a, b) => {
            const timeA = a.createdAt ? a.createdAt.toMillis() : 0;
            const timeB = b.createdAt ? b.createdAt.toMillis() : 0;
            return timeB - timeA;
        });
        
        // 繪製卡片，只顯示最新的 20 筆
        grid.innerHTML = historyData.slice(0, 20).map(item => {
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
        grid.innerHTML = `<p style="color:red; text-align:center;">讀取失敗：${e.message}</p>`; 
    }
}