// ==========================================
// 處理圖片預覽
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

// ==========================================
// 隱形無損引擎：完整保留原圖，並以毛玻璃背景填滿至 9:16
// ==========================================
function processImageTo916(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
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
// 提交任務與輪詢邏輯
// ==========================================
async function startVideoGeneration() {
    const fileInput = document.getElementById('imageInput');
    const promptInput = document.getElementById('promptInput').value.trim();

    if (fileInput.files.length === 0) {
        return alert("請務必上傳一張參考圖片！");
    }
    if (!promptInput) {
        return alert("請務必輸入影片提示詞！");
    }

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
        formData.append("image", processedFile);
        formData.append("prompt", promptInput);

        statusText.innerText = "上傳圖片至伺服器中...";

        const res = await fetch("/api/generate_video", {
            method: "POST",
            body: formData
        });

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
            pollStatus(data.task_id);
        } else {
            throw new Error(data.detail || "未知錯誤");
        }

    } catch (error) {
        statusText.innerText = `❌ 錯誤：\n${error.message}`;
        btn.disabled = false;
        btn.innerText = "🚀 立即生成影片";
    }
}

function pollStatus(taskId) {
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
            statusText.innerText = `🎬 影片渲染中 (高畫質 720p / 15秒)，請耐心等候${dots}`;

            const res = await fetch(`/api/status/${taskId}`);
            const text = await res.text();
            
            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                return;
            }

            if (data.status === "completed") {
                clearInterval(interval);
                statusText.innerText = "🎉 影片生成完成！";
                
                // 畫面預覽直接讀取 Kie.ai 的雲端網址
                resultVideo.src = data.video_url;
                
                // 💡 終極升級：下載按鈕綁定我們的後端代理，強制觸發檔案下載，而非開新網頁
                downloadBtn.href = `/api/download_video?url=${encodeURIComponent(data.video_url)}`;
                
                placeholder.style.display = 'none';
                videoContainer.style.display = 'flex';
                
                btn.disabled = false;
                btn.innerText = "✨ 再做一部影片";

            } else if (data.status === "failed") {
                clearInterval(interval);
                statusText.innerText = `❌ 生成失敗：${data.detail}`;
                btn.disabled = false;
                btn.innerText = "🚀 重新嘗試";
            }
        } catch (error) {
            console.log("輪詢暫時中斷，等待下次重試...", error);
        }
    }, 8000);
}