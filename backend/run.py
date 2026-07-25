"""Dev entry: python run.py  (from backend/ or with PYTHONPATH).

Uses --reload so saving code does not require killing the process.
"""
import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        app_dir=".",  # run from backend/
    )
