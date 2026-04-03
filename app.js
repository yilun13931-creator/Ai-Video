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
    statusText.innerText = "上傳圖片至伺服器中...";
    videoContainer.style.display = 'none';
    placeholder.style.display = 'block';

    try {
        // 使用原生的 FormData 直接封裝圖片檔案，不再使用 Base64
        const formData = new FormData();
        formData.append("image", fileInput.files[0]);
        formData.append("prompt", promptInput);

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
                return;
            }

            if (data.status === "completed") {
                clearInterval(interval);
                statusText.innerText = "🎉 影片生成完成！";
                
                resultVideo.src = data.video_url;
                downloadBtn.href = data.video_url;
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