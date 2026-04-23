import os
import time
import shutil
import glob
import json
from fastapi import FastAPI, HTTPException, Request, UploadFile, Form, File, BackgroundTasks
from pydantic import BaseModel
import requests
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="AI 影片生成引擎")

# ==========================================
# 🌐 解決跨域問題 (CORS)
# ==========================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# 🔑 系統核心設定區
# ==========================================
DEFAPI_BASE_URL = "https://api.defapi.org"

# ==========================================
# 📂 自動圖床與磁碟清理設定
# ==========================================
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# 💡 自動垃圾車：清理過期圖片，確保伺服器硬碟不會爆滿
def cleanup_old_files():
    try:
        now = time.time()
        for filepath in glob.glob(os.path.join(UPLOAD_DIR, "*.jpg")):
            if os.path.isfile(filepath):
                # 檢查檔案建立時間，若超過 3600 秒 (1 小時) 則刪除
                if now - os.path.getmtime(filepath) > 3600:
                    os.remove(filepath)
    except Exception as e:
        print(f"清理舊檔案時發生錯誤: {e}")

# ==========================================
# 🚀 核心 API：提交影片生成任務
# ==========================================
@app.post("/api/generate_video")
def generate_video(
    request: Request, 
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...), 
    prompt: str = Form(...),
    api_key: str = Form(...),
    duration: int = Form(10),
    model_type: str = Form("grok")
):
    # 背景執行垃圾清理，不影響回傳速度
    background_tasks.add_task(cleanup_old_files)

    try:
        # 準備發送給 Defapi 的通用標頭
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json"
        }
        
        # --- 步驟 1：強制處理與儲存圖片 ---
        unique_filename = f"img_{int(time.time())}.jpg"
        file_path = os.path.join(UPLOAD_DIR, unique_filename)
        
        # 將圖片實體儲存到伺服器
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(image.file, buffer)
        
        # 自動合成 Render 上的公開網址
        scheme = request.headers.get("x-forwarded-proto", "https")
        host = request.url.netloc
        public_image_url = f"{scheme}://{host}/uploads/{unique_filename}"

        # --- 步驟 2：動態切換路由，並精準對齊參數名稱 ---
        if model_type == "sora2":
            url = f"{DEFAPI_BASE_URL}/api/sora2/gen"
            payload = {
                "model": "sora-2-stable",
                "prompt": prompt,
                "duration": str(duration),
                # 💡 終極關鍵修正：完全照抄 sora_client.py 的標準格式
                "aspect_ratio": "9:16",
                "must_width": 1,
                "images": [public_image_url] 
            }
        else:
            url = f"{DEFAPI_BASE_URL}/api/grok-imagine-video/gen"
            payload = {
                "model": "grok-imagine-video",
                "prompt": prompt,
                "duration": str(duration),
                "aspect_ratio": "9:16",
                # 💡 修正：依照最新官方文件，Grok 也必須使用 images，已將原本的 image_urls 替換
                "images": [public_image_url] 
            }

        # --- 步驟 3：正式發送請求至 AI 伺服器 ---
        response = requests.post(url, headers=headers, json=payload, timeout=60)
        
        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, detail=f"Defapi 拒絕請求: {response.text}")
            
        res_data = response.json()
        
        # 精準提取 Task ID
        task_id = res_data.get("data", {}).get("task_id") or res_data.get("task_id")
        
        if task_id:
            return {"status": "processing", "task_id": task_id}
        else:
            raise HTTPException(status_code=500, detail=f"API 任務建立失敗: {res_data}")

    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="AI 伺服器無回應，請求超時。")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 🔍 核心 API：輪詢查詢任務狀態
# ==========================================
@app.get("/api/status/{task_id}")
def check_status(task_id: str, api_key: str):
    try:
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json"
        }
        
        # 不管是哪個模型，查詢進度的路由皆一致
        status_url = f"{DEFAPI_BASE_URL}/api/task/query?task_id={task_id}" 
        
        # 附帶超時設定
        response = requests.get(status_url, headers=headers, timeout=30)
        res_data = response.json()
        
        # 提取資料區塊
        data_block = res_data.get("data", res_data)
        raw_state = data_block.get("state", data_block.get("status", ""))
        state = str(raw_state).lower()
        
        # 如果生成成功
        if state in ["success", "completed", "done", "200", "1"]:
            video_url = None
            
            # 💡 終極萬能解析器 (吸收各模型與平台的巢狀回傳格式差異)
            result_obj = data_block.get("result")
            if isinstance(result_obj, dict):
                video_url = result_obj.get("video") or result_obj.get("url")
            
            if not video_url:
                video_url = data_block.get("video_url") or data_block.get("video") or data_block.get("url")
            
            if not video_url and result_obj:
                if isinstance(result_obj, str): 
                    video_url = result_obj
                elif isinstance(result_obj, list) and len(result_obj) > 0:
                    video_url = result_obj[0] if isinstance(result_obj[0], str) else result_obj[0].get("video")

            if video_url:
                return {"status": "completed", "video_url": video_url}
            else:
                return {"status": "failed", "detail": f"影片已生成，但無法提取網址。內容：{data_block}"}
                
        # 如果生成失敗
        elif state in ["fail", "failed", "error", "2", "3", "-1"]:
            fail_msg = data_block.get("failMsg", data_block.get("error", "AI 生成失敗"))
            return {"status": "failed", "detail": fail_msg}
        
        # 還在處理中
        else:
            return {"status": "processing"}

    except requests.exceptions.Timeout:
         return {"status": "processing", "detail": "查詢超時，稍後重試"}
    except Exception as e:
        return {"status": "failed", "detail": f"伺服器解析進度時發生錯誤: {str(e)}"}

# ==========================================
# 💾 核心 API：影片跨域下載代理
# ==========================================
@app.get("/api/download_video")
def download_video(url: str):
    try:
        # 加入 timeout 防止惡意網址卡死伺服器
        req = requests.get(url, stream=True, timeout=30)
        if req.status_code == 200:
            return StreamingResponse(
                req.iter_content(chunk_size=1024 * 1024),
                media_type="video/mp4",
                headers={"Content-Disposition": "attachment; filename=AI_Video.mp4"}
            )
        else:
            raise HTTPException(status_code=400, detail="無法取得影片檔案")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 🌐 網頁與靜態檔案路由
# ==========================================
@app.get("/style.css")
def serve_css(): return FileResponse("style.css")

@app.get("/app.js")
def serve_js(): return FileResponse("app.js")

@app.get("/")
def serve_frontend(): return FileResponse("index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=10000)