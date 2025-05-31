# backend/main.py - Updated with better error handling and debugging
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Dict, Any
import os
import uuid
import shutil
from pathlib import Path
from PIL import Image
import google.generativeai as genai
from dotenv import load_dotenv
import zipfile
import asyncio
from concurrent.futures import ThreadPoolExecutor
import tempfile
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

app = FastAPI(title="AI Image Renamer", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Configure Google AI with better error handling
try:
    api_key = os.environ.get('GOOGLE_API_KEY')
    if not api_key:
        logger.error("GOOGLE_API_KEY not found in environment variables")
        raise ValueError("GOOGLE_API_KEY not found")
    
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel('gemini-1.5-flash')
    logger.info("Google AI configured successfully")
except Exception as e:
    logger.error(f"Failed to configure Google AI: {e}")
    model = None

# Create directories
UPLOAD_DIR = Path("uploads")
PROCESSED_DIR = Path("processed")
UPLOAD_DIR.mkdir(exist_ok=True)
PROCESSED_DIR.mkdir(exist_ok=True)

# AI prompt for image analysis
PROMPT = '''
Analyze this image in detail.
Generate a descriptive image filename using only these rules:
* Relevant keywords describing the image, separated by underscores.
* Lowercase letters only.
* No special characters.
* Keep it short and accurate (max 5-6 words).
Respond ONLY with the image filename (no extension).
Example: child_running_in_the_rain
'''

class ImageInfo(BaseModel):
    id: str
    original_name: str
    suggested_name: str
    file_path: str
    size: int
    status: str = "pending"

class RenameRequest(BaseModel):
    images: List[Dict[str, str]]  # [{"id": "123", "new_name": "custom_name"}]

# In-memory storage for session data
sessions: Dict[str, Dict[str, Any]] = {}

@app.post("/upload")
async def upload_images(files: List[UploadFile] = File(...)):
    """Upload multiple images and return session ID"""
    try:
        logger.info(f"Received {len(files)} files for upload")
        
        session_id = str(uuid.uuid4())
        session_data = {
            "images": {},
            "status": "uploaded"
        }
        
        # Create session directory
        session_dir = UPLOAD_DIR / session_id
        session_dir.mkdir(exist_ok=True)
        logger.info(f"Created session directory: {session_dir}")
        
        uploaded_images = []
        
        for file in files:
            logger.info(f"Processing file: {file.filename}, content_type: {file.content_type}")
            
            # Validate file type
            if not file.content_type or not file.content_type.startswith('image/'):
                logger.warning(f"Skipping non-image file: {file.filename}")
                continue
                
            # Generate unique filename
            file_id = str(uuid.uuid4())
            file_extension = Path(file.filename).suffix.lower()
            file_path = session_dir / f"{file_id}{file_extension}"
            
            # Save file
            try:
                with open(file_path, "wb") as buffer:
                    content = await file.read()
                    buffer.write(content)
                logger.info(f"Saved file: {file_path}")
            except Exception as e:
                logger.error(f"Failed to save file {file.filename}: {e}")
                continue
            
            # Get file size
            file_size = file_path.stat().st_size
            logger.info(f"File size: {file_size} bytes")
            
            image_info = ImageInfo(
                id=file_id,
                original_name=file.filename,
                suggested_name="",
                file_path=str(file_path),
                size=file_size
            )
            
            session_data["images"][file_id] = image_info.dict()
            uploaded_images.append(image_info.dict())
        
        sessions[session_id] = session_data
        logger.info(f"Upload completed. Session ID: {session_id}, Images: {len(uploaded_images)}")
        
        response_data = {
            "session_id": session_id,
            "images": uploaded_images,
            "total_count": len(uploaded_images)
        }
        logger.info(f"Returning response: {response_data}")
        
        return response_data
        
    except Exception as e:
        logger.error(f"Upload error: {e}")
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@app.post("/analyze/{session_id}")
async def analyze_images(session_id: str):
    """Analyze images using AI and generate suggested names"""
    try:
        logger.info(f"Starting analysis for session: {session_id}")
        
        if session_id not in sessions:
            raise HTTPException(status_code=404, detail="Session not found")
        
        if model is None:
            raise HTTPException(status_code=500, detail="AI model not configured properly")
        
        session_data = sessions[session_id]
        logger.info(f"Found {len(session_data['images'])} images to analyze")
        
        # Use ThreadPoolExecutor for concurrent AI processing
        with ThreadPoolExecutor(max_workers=3) as executor:
            tasks = []
            for image_id, image_info in session_data["images"].items():
                logger.info(f"Submitting analysis task for image: {image_id}")
                task = executor.submit(analyze_single_image, image_info)
                tasks.append((image_id, task))
            
            # Collect results
            for image_id, task in tasks:
                try:
                    logger.info(f"Getting result for image: {image_id}")
                    suggested_name = task.result(timeout=60)  # 60 second timeout
                    session_data["images"][image_id]["suggested_name"] = suggested_name
                    session_data["images"][image_id]["status"] = "analyzed"
                    logger.info(f"Analysis complete for {image_id}: {suggested_name}")
                except Exception as e:
                    logger.error(f"Analysis failed for image {image_id}: {e}")
                    session_data["images"][image_id]["status"] = "error"
                    session_data["images"][image_id]["error"] = str(e)
        
        session_data["status"] = "analyzed"
        
        return {
            "session_id": session_id,
            "images": list(session_data["images"].values()),
            "status": "completed"
        }
        
    except Exception as e:
        logger.error(f"Analysis error: {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

def analyze_single_image(image_info: dict) -> str:
    """Analyze a single image and return suggested name"""
    try:
        logger.info(f"Analyzing image: {image_info['original_name']}")
        
        # Check if file exists
        if not Path(image_info["file_path"]).exists():
            raise FileNotFoundError(f"Image file not found: {image_info['file_path']}")
        
        # Open and process image
        with Image.open(image_info["file_path"]) as img:
            # Convert to RGB if needed
            if img.mode != 'RGB':
                img = img.convert('RGB')
            img_copy = img.copy()
        
        logger.info(f"Image loaded successfully: {img_copy.size}")
        
        # Generate content with AI
        response = model.generate_content([PROMPT, img_copy])
        result = response.text.strip()
        
        logger.info(f"AI response: {result}")
        return result
        
    except Exception as e:
        logger.error(f"Error analyzing image {image_info['original_name']}: {e}")
        raise e

@app.post("/rename/{session_id}")
async def rename_images(session_id: str, rename_request: RenameRequest):
    """Rename images based on user selections"""
    try:
        logger.info(f"Starting rename for session: {session_id}")
        
        if session_id not in sessions:
            raise HTTPException(status_code=404, detail="Session not found")
        
        session_data = sessions[session_id]
        
        # Create processed directory for this session
        processed_dir = PROCESSED_DIR / session_id
        processed_dir.mkdir(exist_ok=True)
        
        renamed_images = []
        
        for rename_info in rename_request.images:
            image_id = rename_info["id"]
            new_name = rename_info["new_name"]
            
            if image_id not in session_data["images"]:
                logger.warning(f"Image ID not found: {image_id}")
                continue
            
            image_info = session_data["images"][image_id]
            original_path = Path(image_info["file_path"])
            
            # Create new filename with extension
            file_extension = original_path.suffix
            new_filename = f"{new_name}{file_extension}"
            new_path = processed_dir / new_filename
            
            # Copy file with new name
            shutil.copy2(original_path, new_path)
            logger.info(f"Copied {original_path} to {new_path}")
            
            renamed_images.append({
                "id": image_id,
                "original_name": image_info["original_name"],
                "new_name": new_filename,
                "file_path": str(new_path)
            })
        
        # Create ZIP file with renamed images
        zip_path = processed_dir / "renamed_images.zip"
        with zipfile.ZipFile(zip_path, 'w') as zipf:
            for image in renamed_images:
                zipf.write(image["file_path"], image["new_name"])
        
        logger.info(f"Created ZIP file: {zip_path}")
        
        session_data["status"] = "completed"
        session_data["zip_path"] = str(zip_path)
        
        return {
            "session_id": session_id,
            "renamed_images": renamed_images,
            "download_ready": True
        }
        
    except Exception as e:
        logger.error(f"Rename error: {e}")
        raise HTTPException(status_code=500, detail=f"Rename failed: {str(e)}")

@app.get("/download/{session_id}")
async def download_renamed_images(session_id: str):
    """Download ZIP file containing renamed images"""
    try:
        if session_id not in sessions:
            raise HTTPException(status_code=404, detail="Session not found")
        
        session_data = sessions[session_id]
        
        if "zip_path" not in session_data:
            raise HTTPException(status_code=404, detail="No processed files found")
        
        zip_path = session_data["zip_path"]
        
        if not Path(zip_path).exists():
            raise HTTPException(status_code=404, detail="Download file not found")
        
        return FileResponse(
            zip_path,
            media_type="application/zip",
            filename="renamed_images.zip"
        )
        
    except Exception as e:
        logger.error(f"Download error: {e}")
        raise HTTPException(status_code=500, detail=f"Download failed: {str(e)}")

@app.get("/session/{session_id}")
async def get_session_status(session_id: str):
    """Get current session status and data"""
    try:
        if session_id not in sessions:
            raise HTTPException(status_code=404, detail="Session not found")
        
        session_data = sessions[session_id]
        
        return {
            "session_id": session_id,
            "status": session_data["status"],
            "images": list(session_data["images"].values()),
            "total_count": len(session_data["images"])
        }
        
    except Exception as e:
        logger.error(f"Session status error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get session status: {str(e)}")

@app.delete("/session/{session_id}")
async def cleanup_session(session_id: str):
    """Clean up session files and data"""
    try:
        if session_id not in sessions:
            raise HTTPException(status_code=404, detail="Session not found")
        
        # Remove session directories
        session_upload_dir = UPLOAD_DIR / session_id
        session_processed_dir = PROCESSED_DIR / session_id
        
        if session_upload_dir.exists():
            shutil.rmtree(session_upload_dir)
            logger.info(f"Removed upload directory: {session_upload_dir}")
        if session_processed_dir.exists():
            shutil.rmtree(session_processed_dir)
            logger.info(f"Removed processed directory: {session_processed_dir}")
        
        # Remove from memory
        del sessions[session_id]
        
        return {"message": "Session cleaned up successfully"}
        
    except Exception as e:
        logger.error(f"Cleanup error: {e}")
        raise HTTPException(status_code=500, detail=f"Cleanup failed: {str(e)}")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "message": "AI Image Renamer API is running"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)