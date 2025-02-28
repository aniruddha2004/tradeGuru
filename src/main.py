import io
import os
import json
import requests
import smtplib
import firebase_admin
from firebase_admin import credentials, firestore
from flask import Flask, render_template, request, jsonify, session, send_file
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from langchain.agents.openai_assistant import OpenAIAssistantRunnable
from langchain.agents import AgentExecutor
from langchain_community.tools import TavilySearchResults
from langchain.tools import Tool
from dotenv import load_dotenv
import datetime
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph
from reportlab.lib.units import inch

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY")

# Retrieve the Firebase credentials JSON string from the environment variable
firebase_credentials_json = os.getenv("FIREBASE_CREDENTIALS")
if firebase_credentials_json is None:
    raise ValueError("FIREBASE_CREDENTIALS not set in .env file")

# Convert the JSON string into a Python dictionary
firebase_credentials_dict = json.loads(firebase_credentials_json)

# Initialize Firebase only if it hasn't been initialized already
if not firebase_admin._apps:
    cred = credentials.Certificate(firebase_credentials_dict)
    firebase_admin.initialize_app(cred)

# Create the Firestore client
db = firestore.client()

# Email Configuration (Replace with actual values)
SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587
EMAIL_SENDER = os.getenv("EMAIL_SENDER")  # Your email
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD")  # Your email app password
EXPERT_EMAIL = os.getenv("EXPERT_EMAIL")  # Expert email where queries will be sent

def supavec_retriever(query):
    # Retrieve multiple file ids from environment variable and convert to an array
    file_ids_str = os.getenv("SUPAVEC_FILE_IDS") 
    file_ids = [fid.strip() for fid in file_ids_str.split(";") if fid.strip()]
    
    api_key = os.getenv("SUPAVEC_API_KEY")  # Your supavec API key from .env
    
    url = os.getenv("SUPAVEC_RETREIVER_URL")
    headers = {
        "Content-Type": "application/json",
        "authorization": api_key,
    }
    payload = {"query": query, "file_ids": file_ids}
    
    response = requests.post(url, json=payload, headers=headers)
    if response.status_code == 200:
        # Process and return the JSON response from supavec as needed
        return response.json()
    else:
        # Handle errors appropriately (you might want to raise an exception or return an error dict)
        return {"error": response.text}

# Create a new retrieval tool using the supavec API function
retrieval_tool = Tool(
    name="DB_Retrieval",
    func=supavec_retriever,
    description="Retrieve answers based on user user query using the supavec API."
)

# Initialize Tavily Web Search tool
tavily_tool = TavilySearchResults()

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

@app.route("/suggestions", methods=["GET"])
def get_suggestions():
    suggestions_string = os.getenv("SUGGESTIONS", "")
    suggestions_list = suggestions_string.split(";") if suggestions_string else []
    return jsonify({"suggestions": suggestions_list})

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

    log_data = {"thread_id": thread_id, "user_query": question, "assistant_response": answer, "feedback": "neutral", "timestamp": datetime.datetime.utcnow()}
    # Capture the document reference to get its id.
    _, doc_ref = db.collection("chat_logs").add(log_data)
    doc_id = doc_ref.id

    return jsonify({"answer": answer, "doc_id": doc_id})

@app.route("/feedback", methods=["POST"])
def update_feedback():
    data = request.get_json()
    doc_id = data.get("doc_id")
    feedback_value = data.get("feedback")
    
    if not doc_id or feedback_value not in ("positive", "negative"):
        return jsonify({"error": "Invalid request."}), 400

    try:
        db.collection("chat_logs").document(doc_id).update({"feedback": feedback_value})
        return jsonify({"message": "Feedback updated successfully."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


from reportlab.lib.styles import ParagraphStyle  # Ensure this import is present

def generate_chat_pdf(thread_id, purpose):
    """
    Generate a PDF of the chat logs for the given thread_id.
    Returns a BytesIO buffer containing the PDF.
    """
    pdf_buffer = io.BytesIO()
    # Set margins for a nicer layout.
    doc = SimpleDocTemplate(pdf_buffer, pagesize=letter,
                            rightMargin=72, leftMargin=72,
                            topMargin=72, bottomMargin=72)
    styles = getSampleStyleSheet()
    
    # Define a style for the overview/title.
    overview_style = ParagraphStyle(
        "Overview",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=14,
        spaceAfter=12,
    )
    
    # Define a style for chat entries.
    chat_entry_style = ParagraphStyle(
        "ChatEntry",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=10,
        leading=12,
        spaceAfter=6,
    )
    
    # Define a style for negative feedback entries.
    negative_chat_entry_style = ParagraphStyle(
        "NegativeChatEntry",
        parent=chat_entry_style,
        textColor="red",
    )
    
    elements = []
    
    if purpose == "download":
        message = (
            "<b>Overview :</b><br/>This document contains a detailed record of your interaction with TradeGuru.<br/>"
            "It includes all the questions you asked and TradeGuru's responses, for your reference.<br/><br/><br/><br/>"
        )
        tags = ["You", "TradeGuru"]
        overview = Paragraph(message, overview_style)
    else:
        message = (
            "<b>Overview :</b><br/>This document contains a detailed record of the user's interaction with the TradeGuru Chatbot. "
            "It includes all the questions the user asked and the chatbot’s responses, providing a structured reference for all the queries. "
            "This report has been generated as per our user's request to get their questions answered by an expert.<br/><br/><br/><br/>"
        )
        tags = ["Query", "Response"]
        overview = Paragraph(message, overview_style)
    
    elements.append(overview)
    
    # Fetch chat logs and add entries.
    chat_logs = db.collection("chat_logs").where("thread_id", "==", thread_id).order_by("timestamp").stream()
    for log in chat_logs:
        data = log.to_dict()
        # For expert purpose, if feedback is negative, use the negative style.
        if purpose == "expert" and data.get("feedback", "neutral") == "negative":
            user_style = negative_chat_entry_style
            assistant_style = negative_chat_entry_style
        else:
            user_style = chat_entry_style
            assistant_style = chat_entry_style
        
        elements.append(Paragraph(f"<b>{tags[0]} :</b> {data['user_query']}", user_style))
        elements.append(Paragraph(f"<b>{tags[1]} :</b> {data['assistant_response']}", assistant_style))
        elements.append(Paragraph("<br/><br/>", chat_entry_style))
    
    # Build the PDF into the buffer and reset the pointer to the beginning.
    doc.build(elements)
    pdf_buffer.seek(0)
    return pdf_buffer



# New endpoint for downloading the PDF
@app.route('/download-pdf', methods=['GET'])
def download_pdf():
    if "thread_id" not in session:
        return jsonify({"message": "There has not been any conversation till now! Nothing to send to expert."})
    thread_id = session["thread_id"]
    
    pdf_buffer = generate_chat_pdf(thread_id, "download")
    return send_file(pdf_buffer,
                     as_attachment=True,
                     download_name='conversation.pdf',
                     mimetype='application/pdf')


@app.route('/ask-expert', methods=['POST'])
def ask_expert():
    if "thread_id" not in session:
        return jsonify({"message": "There has not been any conversation till now! Nothing to send to expert."})
    thread_id = session["thread_id"]
    
    pdf_buffer = generate_chat_pdf(thread_id, "expert")
    pdf_bytes = pdf_buffer.getvalue()
    send_email(pdf_bytes, EXPERT_EMAIL)  # Updated send_email to accept PDF bytes.
    
    return jsonify({"message": "Your conversation history has been successfully sent to an expert! You'll receive a response soon."})


def send_email(pdf_data, recipient_email):
    """Send the conversation PDF (provided as bytes) via email."""
    msg = MIMEMultipart()
    msg["From"] = EMAIL_SENDER
    msg["To"] = recipient_email
    msg["Subject"] = "TradeGuru - Chat Log Report"

    body = "Attached is the conversation history for expert review."
    msg.attach(MIMEText(body, "plain"))

    part = MIMEBase("application", "octet-stream")
    part.set_payload(pdf_data)
    encoders.encode_base64(part)
    # Provide a default filename for the attachment
    part.add_header("Content-Disposition", 'attachment; filename="conversation.pdf"')
    msg.attach(part)

    server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT)
    server.starttls()
    server.login(EMAIL_SENDER, EMAIL_PASSWORD)
    server.sendmail(EMAIL_SENDER, recipient_email, msg.as_string())
    server.quit()


@app.route("/reset-session", methods=["POST"])
def reset_session():
    if "thread_id" in session :
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
    app.run(host="0.0.0.0", debug=False, port=34567)
