CREATE TABLE IF NOT EXISTS kpi_documents (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  byte_length INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kpi_document_chunks (
  document_id TEXT NOT NULL REFERENCES kpi_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  bytes BLOB NOT NULL,
  PRIMARY KEY (document_id, chunk_index)
);
