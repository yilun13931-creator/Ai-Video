// ==========================================
// 處理圖片預覽與前端自動 Base64 壓縮
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

async function compressImageToBase64(file, maxWidth = 1024, maxHeight = 1024) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                // 轉為 Base64 包含 MIME type (API 需要)
                resolve(canvas.toDataURL('image/jpeg', 0.8));
            };
        };
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
    statusText.innerText = "正在壓縮圖片並上傳至 AI 大腦...";
    videoContainer.style.display = 'none';
    placeholder.style.display = 'block';

    try {
        // 1. 圖片轉 Base64
        const imageB64 = await compressImageToBase64(fileInput.files[0]);

        // 2. 發送給後端
        const payload = {
            image_b64: imageB64,
            prompt: promptInput
        };

        const res = await fetch("/api/generate_video", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        // 🛡️ 新增保護機制：先將回應轉為純文字，避免直接 json() 解析失敗報錯
        const responseText = await res.text();
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (jsonError) {
            throw new Error(`伺服器或路由異常 (狀態碼: ${res.status}): ${responseText.substring(0, 80)}... \n👉 請確認您是透過 Render 網址訪問，而非直接點擊本地 HTML 檔案。`);
        }

        if (!res.ok) {
            throw new Error(data.detail || "未知錯誤");
        }

        if (data.task_id) {
            statusText.innerText = "✅ 任務已啟動！AI 正在進行算圖，約需 2~5 分鐘...";
            pollStatus(data.task_id);
        } else {
            throw new Error(data.detail || "未知錯誤");
        }

    } catch (error) {
        statusText.innerText = `❌ 錯誤：${error.message}`;
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
            statusText.innerText = `🎬 影片渲染中 (固定 9:16 / 15秒)，請耐心等候${dots}`;

            const res = await fetch(`/api/status/${taskId}`);
            const text = await res.text();
            
            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                // 若遇到暫時性的 502/504 錯誤，忽略並繼續等待下次輪詢
                return;
            }

            if (data.status === "completed") {
                clearInterval(interval);
                statusText.innerText = "🎉 影片生成完成！";
                
                // 顯示影片
                resultVideo.src = data.video_url;
                downloadBtn.href = data.video_url;
                placeholder.style.display = 'none';
                videoContainer.style.display = 'flex';
                
                // 恢復按鈕
                btn.disabled = false;
                btn.innerText = "✨ 再做一部影片";

            } else if (data.status === "failed") {
                clearInterval(interval);
                statusText.innerText = `❌ 生成失敗：${data.detail}`;
                btn.disabled = false;
                btn.innerText = "🚀 重新嘗試";
            }
        } catch (error) {
            // 遇到網路抖動不中斷，繼續輪詢
            console.log("輪詢暫時中斷，等待下次重試...", error);
        }
    }, 8000); // 每 8 秒查一次，完美避開 Timeout
}