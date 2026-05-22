@app.post("/ask")
def ask(req: AskRequest):
    question = req.question.strip()

    if not question:
        raise HTTPException(status_code=400, detail="Question is empty.")

    q_emb = get_embedding(question)
    q_halfvec = vector_to_halfvec_sql(q_emb)

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

    if not rows:
        return {
            "answer": NOT_FOUND_TR,
            "sources": [],
        }

    top_similarity = float(rows[0][3])

    if top_similarity < SIMILARITY_THRESHOLD:
        return {
            "answer": NOT_FOUND_TR,
            "sources": [],
        }

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
            "answer": NOT_FOUND_TR,
            "sources": [],
        }

    context = ""
    sources = []

    for item in relevant:
        piece = (
            f"\nSOURCE: {item['file_name']} | CHUNK: {item['chunk_index']} "
            f"| SIMILARITY: {item['similarity']:.4f}\n"
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

    answer = ask_llm(question, context)

    return {
        "answer": answer,
        "sources": sources,
    }





def ask_llm(question: str, context: str) -> str:
    if not REMOTE_CHAT_URL:
        raise HTTPException(status_code=500, detail="REMOTE_CHAT_URL missing.")

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {REMOTE_API_KEY}",
    }

    system_prompt = """
You are a strict RAG assistant.
Answer only using the provided context.
If the answer is not clearly present in the context, say exactly:
Bu bilgi yuklenen dokumanlarda bulunamadi.

Do not use outside knowledge.
Do not guess.
Respond in Turkish.
"""

    payload = {
        "model": REMOTE_CHAT_MODEL,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": f"Context:\n{context}\n\nQuestion:\n{question}"
            }
        ]
    }

    resp = requests.post(
        REMOTE_CHAT_URL,
        headers=headers,
        json=payload,
        timeout=120,
    )

    if resp.status_code != 200:
        logger.error("Chat API error: %s - %s", resp.status_code, resp.text)
        raise HTTPException(status_code=500, detail="Chat API error.")

    data = resp.json()
    return data["choices"][0]["message"]["content"].strip()
