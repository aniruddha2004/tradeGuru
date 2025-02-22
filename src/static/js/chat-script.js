// State management
let messages = [];
let queries = [];

// DOM Elements
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");
const messagesContainer = document.getElementById("messagesContainer");
const queriesList = document.getElementById("queriesList");
const menuToggle = document.getElementById("menuToggle");
const queriesPanel = document.getElementById("queriesPanel");
const resetButton = document.getElementById("reset-btn");

// Helper function to format date
function formatDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(date));
}

function formatTime(date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(date));
}

// Render messages
function renderMessage(message) {
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${message.sender}`;
  if(message.loader) {
    messageDiv.innerHTML = `
    <div class="message-content" id="loading-message">
      <div>${message.content}</div>
    </div>
  `;
  }
  else {
    messageDiv.innerHTML = `
    <div class="message-content">
      <div>${message.content}</div>
      <div class="message-time">${formatTime(message.timestamp)}</div>
    </div>
  `;
  }

  // If it's an assistant message, add a bookmark button
  if (message.sender === "assistant" && !(message.loader)) {
    const bookmarkButton = document.createElement("button");
    bookmarkButton.className = "bookmark-button";
    bookmarkButton.innerHTML = '<i class="fa fa-bookmark-o" style="color: rgba(17,25,44,255)"></i>'; // Bookmark icon
    bookmarkButton.addEventListener("click", () => bookmarkResponse(message));
    messageDiv.appendChild(bookmarkButton);
  }

  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Render queries (only assistant messages that were bookmarked)
function renderQuery(query) {
  const queryDiv = document.createElement("div");
  queryDiv.className = "query-card";
  queryDiv.innerHTML = `
    <div class="query-timestamp">${formatDate(query.timestamp)}</div>
    <div class="query-content">${query.content}</div>
  `;
  queriesList.appendChild(queryDiv);
  queriesList.scrollTop = queriesList.scrollHeight;
}

// Function to bookmark an assistant's response
function bookmarkResponse(message) {
  // Prevent duplicate bookmarks
  if (queries.some((q) => q.id === message.id)) return;

  const query = {
    id: message.id,
    content: message.content,
    timestamp: message.timestamp,
  };

  queries.push(query);
  renderQuery(query);
}

messageForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const content = messageInput.value.trim();
  if (!content) return;

  const timestamp = new Date().toISOString();

  const message = {
    id: messages.length + 1,
    content,
    sender: "user",
    timestamp,
  };

  const loadingMessage = {
    id: messages.length + 1,
    content : "Typing...",
    sender: "assistant",
    timestamp,
    loader : true
  };

  messages.push(message);
  renderMessage(message);
  renderMessage(loadingMessage);

  messageInput.value = "";

  try {
    const response = await fetch("/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: content }),
    });

    const data = await response.json();
    const markdownContent = data.answer;

    // Convert Markdown to HTML using marked.js
    const renderedHTML = marked.parse(markdownContent);

    const botMessage = {
      id: messages.length + 1,
      content: renderedHTML, // Store HTML-rendered content
      sender: "assistant",
      timestamp: new Date().toISOString(),
      loader: false
    };
    document.getElementById("loading-message").remove()
    messages.push(botMessage);
    renderMessage(botMessage);
  } catch (error) {
    const botMessage = {
      id: messages.length + 1,
      content: "Error fetching response!",
      sender: "assistant",
      timestamp: new Date().toISOString(),
    };
    document.getElementById("loading-message").remove()
    messages.push(botMessage);
    renderMessage(botMessage);
  }
});


// Reset chat
function resetChat() {
  fetch("/reset-session", { method: "POST" }).then(() => {
    messagesContainer.innerHTML = "";
    messages = [];
    displayWelcomeMessage();
  });
}

resetButton.addEventListener("click", resetChat);

// Display welcome message
function displayWelcomeMessage() {
  const welcomeMessage = {
    id: 0,
    content: "Welcome! How can I help you today?",
    sender: "assistant",
    timestamp: new Date().toISOString(),
  };
  renderMessage(welcomeMessage);
}

document.addEventListener("DOMContentLoaded", displayWelcomeMessage);

// Mobile menu toggle
menuToggle.addEventListener("click", () => {
  queriesPanel.classList.toggle("active");
});

// Close panel when clicking outside on mobile
document.addEventListener("click", (e) => {
  if (
    window.innerWidth <= 768 &&
    !queriesPanel.contains(e.target) &&
    !menuToggle.contains(e.target) &&
    queriesPanel.classList.contains("active")
  ) {
    queriesPanel.classList.remove("active");
  }
});

// Ask an expert
document.querySelector(".expert-link").addEventListener("click", () => {
  const timestamp = new Date().toISOString();
  const loadingMessage = {
    id: messages.length + 1,
    content : "Forwarding your request to an expert for review..",
    sender: "assistant",
    timestamp,
    loader : true
  };
  renderMessage(loadingMessage)
  fetch("/ask-expert", { method: "POST" })
    .then((response) => response.json())
    .then((data) => {
      const newTimestamp = new Date().toISOString();
      const responseMessage = {
        id: messages.length + 1,
        content : "Your request has been successfully sent to an expert! You'll receive a response soon.",
        sender: "assistant",
        timestamp: newTimestamp,
        loader : false
      };
      document.getElementById("loading-message").remove()
      renderMessage(responseMessage)
    })
    .then((data) => alert(data.message));
});
