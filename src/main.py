import os
import smtplib
import firebase_admin
from firebase_admin import credentials, firestore
from flask import Flask, render_template, request, jsonify, session
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from langchain.agents.openai_assistant import OpenAIAssistantRunnable
from langchain.agents import AgentExecutor
from langchain_community.tools import TavilySearchResults
from langchain.tools import Tool
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_milvus import Milvus
from dotenv import load_dotenv
import datetime
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph
from reportlab.lib.units import inch

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY")

# Firebase setup (Ensure Firebase JSON file is in your project directory)
FIREBASE_CREDENTIALS = "firebase-admin-sdk.json"
if not firebase_admin._apps:  # Prevent re-initialization
    cred = credentials.Certificate(FIREBASE_CREDENTIALS)
    firebase_admin.initialize_app(cred)

db = firestore.client()

# Email Configuration (Replace with actual values)
SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587
EMAIL_SENDER = os.getenv("EMAIL_SENDER")  # Your email
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD")  # Your email app password
EXPERT_EMAIL = os.getenv("EXPERT_EMAIL")  # Expert email where queries will be sent

# Initialize Tavily Web Search tool
tavily_tool = TavilySearchResults()

# Initialize Hugging Face Embeddings
embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")

# Initialize Milvus (Zilliz Vector Database)
vector_db = Milvus(
    embedding_function=embeddings,
    connection_args={"uri": os.getenv("ZILLIZ_CLOUD_URI"), "user": os.getenv("ZILLIZ_CLOUD_USERNAME"), "password": os.getenv("ZILLIZ_CLOUD_PASSWORD"), "secure": True},
    collection_name="election",
)

# Define a retrieval tool for querying the vector database
retriever = vector_db.as_retriever()
retrieval_tool = Tool(name="DB_Retrieval", func=retriever.get_relevant_documents, description="Retrieve answers from the database.")

# Define Tavily search as another tool
web_search_tool = Tool(name="Web_Search", func=tavily_tool.invoke, description="Search the web for additional context.")

# Create OpenAI Assistant using LangChain’s OpenAIAssistantRunnable
assistant_agent = OpenAIAssistantRunnable.create_assistant(
    name="Conversational Assistant",
    instructions=os.getenv("SYSTEM_PROMPT"),
    tools=[retrieval_tool, web_search_tool],
    model="gpt-4o",
    as_agent=True,
)

# Use LangChain’s AgentExecutor to manage tool execution
agent_executor = AgentExecutor(agent=assistant_agent, tools=[retrieval_tool, web_search_tool], verbose=True)

@app.route("/")
def landing_page():
    return render_template("landing.html")

@app.route("/chat")
def chat_page():
    return render_template("chat.html")

@app.route("/ask", methods=["POST"])
def ask_question():
    data = request.get_json()
    question = data.get("question", "")

    if not question:
        return jsonify({"answer": "Please provide a valid question."})

    if "thread_id" not in session:
        response = agent_executor.invoke({"content": question})
        session["thread_id"] = response.get("thread_id")
    else:
        thread_id = session["thread_id"]
        response = agent_executor.invoke({"content": question, "thread_id": thread_id})

    answer = response["output"]
    thread_id = session["thread_id"]

    log_data = {"thread_id": thread_id, "user_query": question, "assistant_response": answer, "timestamp": datetime.datetime.utcnow()}
    db.collection("chat_logs").add(log_data)

    return jsonify({"answer": answer})

@app.route("/ask-expert", methods=["POST"])
def ask_expert():
    """Fetch conversation history, save it as a PDF, and email it to an expert."""
    if "thread_id" not in session:
        return jsonify({"message": "No conversation history found!"})

    thread_id = session["thread_id"]
    chat_logs = db.collection("chat_logs").where("thread_id", "==", thread_id).order_by("timestamp").stream()

    pdf_filename = f"Chat_Log_Report_{thread_id}.pdf"

    # Create a PDF document with proper formatting
    doc = SimpleDocTemplate(pdf_filename, pagesize=letter)
    styles = getSampleStyleSheet()
    elements = []

    # Add Title
    elements.append(Paragraph(f"<b>Overview : </b>This document contains a detailed record of the uers interaction with the PaperMind Chatbot. It includes all the questions the user asked and the chatbot’s responses, providing a structured reference for your queries related to election data. This report has been generated as per our users request to get their questions answered by an expert.</p><br/><br/><br/><br/>", styles["Normal"]))

    for log in chat_logs:
        data = log.to_dict()
        
        # Add User Message
        elements.append(Paragraph(f"<b>User:</b> {data['user_query']}", styles["Normal"]))
        elements.append(Paragraph(f"<b>Chatbot:</b> {data['assistant_response']}", styles["Normal"]))

        # Add spacing
        elements.append(Paragraph("<br/><br/>", styles["Normal"]))

    # Build PDF
    doc.build(elements)

    # Send Email
    send_email(pdf_filename, EXPERT_EMAIL)

    # Delete the PDF after sending
    os.remove(pdf_filename)

    return jsonify({"message": "Conversation history sent to expert successfully!"})

def send_email(pdf_filename, recipient_email):
    """Send the conversation PDF via email."""
    msg = MIMEMultipart()
    msg["From"] = EMAIL_SENDER
    msg["To"] = recipient_email
    msg["Subject"] = "Election Data Expert Consultation - Chat Log Report"

    body = "Attached is the conversation history for expert review."
    msg.attach(MIMEText(body, "plain"))

    attachment = open(pdf_filename, "rb")
    part = MIMEBase("application", "octet-stream")
    part.set_payload(attachment.read())
    encoders.encode_base64(part)
    part.add_header("Content-Disposition", f"attachment; filename={pdf_filename}")
    msg.attach(part)
    attachment.close()

    server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT)
    server.starttls()
    server.login(EMAIL_SENDER, EMAIL_PASSWORD)
    server.sendmail(EMAIL_SENDER, recipient_email, msg.as_string())
    server.quit()

@app.route("/reset-session", methods=["POST"])
def reset_session():
    thread_id = session["thread_id"]
    # Query documents with matching `thread_id`
    chat_logs = db.collection("chat_logs").where("thread_id", "==", thread_id).stream()

    # Iterate and delete each document
    for doc in chat_logs:
        print(f"Deleting document {doc.id}")  # Optional: To check which docs are deleted
        db.collection("chat_logs").document(doc.id).delete()
    
    session.pop("thread_id", None)
    return jsonify({"message": "Session reset successfully!"})

# Custom 404 Error Handler
@app.errorhandler(404)
def page_not_found(e):
    return render_template("404.html"), 404

if __name__ == "__main__":
    app.run(debug=True)
