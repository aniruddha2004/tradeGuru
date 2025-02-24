import os
import getpass
from langchain_community.document_loaders import TextLoader
from langchain_milvus import Milvus
from dotenv import load_dotenv
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_text_splitters import CharacterTextSplitter
import os

load_dotenv()

# Load document
file_path = "C:/xampp/htdocs/PaperMind/src/TF.txt"  # Change to your actual file path
loader = TextLoader(file_path, encoding="utf-8")
documents = loader.load()

for doc in documents:
    doc.metadata["source"] = "Beginners guide to Trade Finance"

# Split text into chunks
text_splitter = CharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
docs = text_splitter.split_documents(documents)

print(docs)

# Generate embeddings
embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")

# Store in Zilliz Cloud
vector_db = Milvus.from_documents(
    docs,
    embeddings,
    connection_args={"uri": os.getenv("ZILLIZ_CLOUD_URI"), "user": os.getenv("ZILLIZ_CLOUD_USERNAME"), "password": os.getenv("ZILLIZ_CLOUD_PASSWORD"), "secure": True},
    collection_name="tradeDocuments",
    text_field="text"
)


