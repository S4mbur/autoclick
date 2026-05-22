import os
import uuid
import logging
from typing import List

import requests
import psycopg2
from psycopg2.extras import execute_values
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from pypdf import PdfReader
from dotenv import load_dotenv

load_dotenv()

PG_HOST = os.getenv("PG_HOST")
PG_PORT = int(os.getenv("PG_PORT", "5432"))
PG_DBNAME = os.getenv("PG_DBNAME")
PG_USER = os.getenv("PG_USER")
PG_PASSWORD = os.getenv("PG_PASSWORD")
PG_TABLE = os.getenv("PG_TABLE", "ai_docs")

REMOTE_API_URL = os.getenv("REMOTE_API_URL")
REMOTE_API_KEY = os.getenv("REMOTE_API_KEY")
REMOTE_MODEL_NAME = os.getenv("REMOTE_MODEL_NAME")

EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", "4096"))
HALFVEC_DIM = int(os.getenv("HALFVEC_DIM", "2048"))
TOP_K = int(os.getenv("TOP_K", "5"))
SIMILARITY_THRESHOLD = float(os.getenv("SIMILARITY_THRESHOLD", "0.30"))
MAX_CONTEXT_LENGTH = int(os.getenv("MAX_CONTEXT_LENGTH", "10000"))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("pdf-rag-halfvec")

app = FastAPI(title="PDF RAG App")


class AskRequest(BaseModel):
    question: str


def get_connection():
    return psycopg2.connect(
        host=PG_HOST,
        port=PG_PORT,
        dbname=PG_DBNAME,
        user=PG_USER,
        password=PG_PASSWORD,
    )


def vector_to_sql(v: List[float]) -> str:
    return "[" + ",".join(str(float(x)) for x in v) + "]"


def vector_to_halfvec_sql(v: List[float]) -> str:
    half = v[:HALFVEC_DIM]
    return "[" + ",".join(str(float(x)) for x in half) + "]"


def get_embedding(text: str) -> List[float]:
    if not REMOTE_API_URL:
        raise RuntimeError("REMOTE_API_URL yok.")

    if not REMOTE_API_KEY:
        raise RuntimeError("REMOTE_API_KEY yok.")

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {REMOTE_API_KEY}",
    }

    payload = {
        "model": REMOTE_MODEL_NAME,
        "input": text,
    }

    resp = requests.post(
        REMOTE_API_URL,
        headers=headers,
        json=payload,
        timeout=90,
    )

    if resp.status_code != 200:
        logger.error("Embedding API error: %s - %s", resp.status_code, resp.text)
        raise HTTPException(status_code=500, detail="Embedding API hata verdi.")

    data = resp.json()

    try:
        emb = data["data"][0]["embedding"]
    except Exception:
        logger.error("Embedding response: %s", data)
        raise HTTPException(
            status_code=500,
            detail="Embedding response formatı beklenen gibi değil.",
        )

    if len(emb) != EMBEDDING_DIM:
        raise HTTPException(
            status_code=500,
            detail=f"Embedding dimension uyumsuz. Beklenen={EMBEDDING_DIM}, Gelen={len(emb)}",
        )

    return emb


def extract_pdf_text(file_path: str) -> str:
    reader = PdfReader(file_path)
    pages = []

    for page_no, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        if text.strip():
            pages.append(f"\n--- PAGE {page_no} ---\n{text}")

    return "\n".join(pages)


def chunk_text(text: str, chunk_size: int = 1200, overlap: int = 200) -> List[str]:
    text = " ".join(text.split())

    chunks = []
    start = 0

    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end].strip()

        if chunk:
            chunks.append(chunk)

        start += chunk_size - overlap

    return chunks


@app.get("/", response_class=HTMLResponse)
def ui():
    return """
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <title>PDF RAG Chat</title>
  <style>
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      background: #f4f4f5;
      color: #111827;
    }

    .container {
      max-width: 900px;
      margin: 40px auto;
      padding: 20px;
    }

    .card {
      background: white;
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.08);
      margin-bottom: 20px;
    }

    h1 {
      margin-top: 0;
      font-size: 28px;
    }

    .upload-area {
      border: 2px dashed #9ca3af;
      border-radius: 14px;
      padding: 24px;
      text-align: center;
      background: #fafafa;
    }

    input[type="file"] {
      margin-top: 12px;
    }

    button {
      border: none;
      border-radius: 10px;
      padding: 12px 18px;
      background: #111827;
      color: white;
      cursor: pointer;
      font-weight: 600;
      margin-top: 12px;
    }

    button:hover {
      background: #374151;
    }

    textarea {
      width: 100%;
      min-height: 90px;
      resize: vertical;
      border-radius: 12px;
      border: 1px solid #d1d5db;
      padding: 14px;
      font-size: 15px;
      box-sizing: border-box;
    }

    .chat-box {
      min-height: 260px;
      max-height: 520px;
      overflow-y: auto;
      background: #f9fafb;
      border-radius: 14px;
      padding: 18px;
      border: 1px solid #e5e7eb;
      white-space: pre-wrap;
    }

    .message {
      padding: 14px;
      border-radius: 14px;
      margin-bottom: 12px;
      line-height: 1.5;
    }

    .user {
      background: #e0f2fe;
      margin-left: 80px;
    }

    .bot {
      background: #ffffff;
      border: 1px solid #e5e7eb;
      margin-right: 80px;
    }

    .status {
      font-size: 14px;
      color: #6b7280;
      margin-top: 10px;
    }

    .row {
      display: flex;
      gap: 10px;
      align-items: flex-start;
    }

    .row textarea {
      flex: 1;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>PDF RAG Chat</h1>
      <p>PDF yükle, sonra sadece bu dokümanlara göre soru sor.</p>

      <div class="upload-area">
        <strong>PDF Dosyaları</strong><br />
        <input id="pdfFiles" type="file" accept="application/pdf" multiple />
        <br />
        <button onclick="uploadPdfs()">PDF'leri Yükle</button>
        <div id="uploadStatus" class="status"></div>
      </div>
    </div>

    <div class="card">
      <div id="chatBox" class="chat-box">
        <div class="message bot">Merhaba. PDF yükledikten sonra soru sorabilirsin.</div>
      </div>

      <br />

      <div class="row">
        <textarea id="question" placeholder="Dokümanlara göre sorunuzu yazın..."></textarea>
        <button onclick="askQuestion()">Sor</button>
      </div>
    </div>
  </div>

<script>
async function uploadPdfs() {
  const input = document.getElementById("pdfFiles");
  const status = document.getElementById("uploadStatus");

  if (!input.files.length) {
    status.innerText = "Lütfen en az bir PDF seç.";
    return;
  }

  const formData = new FormData();

  for (const file of input.files) {
    formData.append("files", file);
  }

  status.innerText = "PDF'ler yükleniyor ve embedding oluşturuluyor...";

  try {
    const res = await fetch("/upload-pdfs", {
      method: "POST",
      body: formData
    });

    const data = await res.json();

    if (!res.ok) {
      status.innerText = "Hata: " + JSON.stringify(data);
      return;
    }

    status.innerText = "Yüklendi. Chunk sayısı: " + data.inserted_chunks;
  } catch (err) {
    status.innerText = "İstek hatası: " + err;
  }
}

function addMessage(text, type) {
  const chatBox = document.getElementById("chatBox");

  const div = document.createElement("div");
  div.className = "message " + type;
  div.innerText = text;

  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;

  return div;
}

async function askQuestion() {
  const q = document.getElementById("question");
  const question = q.value.trim();

  if (!question) return;

  addMessage(question, "user");
  q.value = "";

  const loadingMsg = addMessage("Cevap aranıyor...", "bot");

  try {
    const res = await fetch("/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ question })
    });

    const data = await res.json();

    if (!res.ok) {
      loadingMsg.innerText = "Hata: " + JSON.stringify(data);
      return;
    }

    let answer = data.answer || "Cevap bulunamadı.";

    if (data.sources && data.sources.length > 0) {
      answer += "\\n\\nKaynaklar:\\n";
      data.sources.forEach((s, i) => {
        answer += `${i + 1}. ${s.file_name} / chunk ${s.chunk_index} / similarity ${s.similarity.toFixed(4)}\\n`;
      });
    }

    loadingMsg.innerText = answer;

  } catch (err) {
    loadingMsg.innerText = "İstek hatası: " + err;
  }
}

document.getElementById("question").addEventListener("keydown", function(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    askQuestion();
  }
});
</script>
</body>
</html>
"""


@app.post("/upload-pdfs")
async def upload_pdfs(files: List[UploadFile] = File(...)):
    if len(files) > 10:
        raise HTTPException(status_code=400, detail="En fazla 10 PDF yükleyebilirsin.")

    os.makedirs("uploads", exist_ok=True)

    inserted_total = 0
    results = []

    conn = get_connection()

    try:
        with conn:
            with conn.cursor() as cur:
                for uploaded_file in files:
                    if not uploaded_file.filename.lower().endswith(".pdf"):
                        raise HTTPException(
                            status_code=400,
                            detail=f"{uploaded_file.filename} PDF değil.",
                        )

                    safe_name = f"{uuid.uuid4()}_{uploaded_file.filename}"
                    file_path = os.path.join("uploads", safe_name)

                    content = await uploaded_file.read()

                    with open(file_path, "wb") as f:
                        f.write(content)

                    text = extract_pdf_text(file_path)

                    if not text.strip():
                        results.append({
                            "file": uploaded_file.filename,
                            "status": "text bulunamadı",
                            "chunks": 0,
                        })
                        continue

                    chunks = chunk_text(text)

                    rows = []

                    for idx, chunk in enumerate(chunks):
                        emb = get_embedding(chunk)

                        if len(emb) != 4096:
                            raise HTTPException(
                                status_code=500,
                                detail=f"Embedding 4096 değil. Gelen={len(emb)}",
                            )

                        full_vector = vector_to_sql(emb)
                        half_vector = vector_to_halfvec_sql(emb)

                        rows.append((
                            uploaded_file.filename,
                            idx,
                            chunk,
                            full_vector,
                            half_vector,
                        ))

                    execute_values(
                        cur,
                        f"""
                        INSERT INTO {PG_TABLE}
                        (file_name, chunk_index, content, embedding, embedding_half)
                        VALUES %s
                        """,
                        rows,
                        template="(%s, %s, %s, %s::vector(4096), %s::halfvec(2048))",
                    )

                    inserted_total += len(rows)

                    results.append({
                        "file": uploaded_file.filename,
                        "status": "ok",
                        "chunks": len(rows),
                    })

        return {
            "status": "success",
            "inserted_chunks": inserted_total,
            "files": results,
        }

    finally:
        conn.close()


@app.post("/ask")
def ask(req: AskRequest):
    question = req.question.strip()

    if not question:
        raise HTTPException(status_code=400, detail="Soru boş olamaz.")

    q_emb = get_embedding(question)

    if len(q_emb) != 4096:
        raise HTTPException(
            status_code=500,
            detail=f"Question embedding 4096 değil. Gelen={len(q_emb)}",
        )

    q_halfvec = vector_to_halfvec_sql(q_emb)

    logger.info("Question embedding dim: %s", len(q_emb))
    logger.info("Question halfvec dim: %s", len(q_emb[:HALFVEC_DIM]))

    conn = get_connection()

    try:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    file_name,
                    chunk_index,
                    content,
                    1 - (embedding_half <=> %s::halfvec(2048)) AS similarity
                FROM {PG_TABLE}
                WHERE embedding_half IS NOT NULL
                ORDER BY embedding_half <=> %s::halfvec(2048)
                LIMIT %s
                """,
                (q_halfvec, q_halfvec, TOP_K),
            )

            rows = cur.fetchall()

    finally:
        conn.close()

    relevant = [
        {
            "file_name": r[0],
            "chunk_index": r[1],
            "content": r[2],
            "similarity": float(r[3]),
        }
        for r in rows
        if float(r[3]) >= SIMILARITY_THRESHOLD
    ]

    if not relevant:
        return {
            "answer": "Bu bilgi yüklenen dokümanlarda bulunamadı.",
            "sources": [],
        }

    context = ""
    sources = []

    for item in relevant:
        piece = (
            f"\n[Kaynak: {item['file_name']} - Chunk {item['chunk_index']} "
            f"- Similarity: {item['similarity']:.4f}]\n"
            f"{item['content']}\n"
        )

        if len(context) + len(piece) > MAX_CONTEXT_LENGTH:
            break

        context += piece

        sources.append({
            "file_name": item["file_name"],
            "chunk_index": item["chunk_index"],
            "similarity": item["similarity"],
        })

    return {
        "answer": context,
        "sources": sources,
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.delete("/clear")
def clear_documents():
    conn = get_connection()

    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(f"DELETE FROM {PG_TABLE}")

        return {
            "status": "success",
            "message": "Tüm doküman chunkları silindi.",
        }

    finally:
        conn.close()
