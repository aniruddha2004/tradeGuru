// State management
let messages = [];
let queries = [];

// DOM Elements
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const voiceButton = document.getElementById("voiceButton");
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

// In renderMessage, assign a unique id to each message
function renderMessage(message) {
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${message.sender}`;
  messageDiv.id = "message-" + message.id; // Unique id for scrolling

  if (message.loader) {
    messageDiv.innerHTML = `
      <div class="message-content" id="loading-message">
        <div>${message.content}</div>
      </div>
    `;
  } else {
    messageDiv.innerHTML = `
      <div class="message-content">
        <div>${message.content}</div>
        <div class="message-time">${formatTime(message.timestamp)}</div>
      </div>
    `;
  }

  // Add bookmark button for assistant messages
  if (message.sender === "assistant" && !message.loader) {
    const bookmarkButton = document.createElement("button");
    bookmarkButton.className = "bookmark-button";
    bookmarkButton.innerHTML =
      '<i class="fa fa-bookmark-o" style="color: rgba(17,25,44,255)"></i>';
    bookmarkButton.addEventListener("click", () => bookmarkResponse(message));
    messageDiv.appendChild(bookmarkButton);
  }

  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// In renderQuery, attach a click listener to scroll to the corresponding message
function renderQuery(query) {
  const queryDiv = document.createElement("div");
  queryDiv.className = "query-card";
  // Using the first line of the message for display; CSS can handle overflow styling.
  queryDiv.innerHTML = `
    <div class="query-timestamp">${formatDate(query.timestamp)}</div>
    <div class="query-content">${query.content.split('\n')[0]}</div>
  `;

  queryDiv.addEventListener('click', () => {
    const target = document.getElementById('message-' + query.id);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Optional: add a temporary highlight to the message
      target.classList.add('highlight');
      setTimeout(() => {
        target.classList.remove('highlight');
      }, 2000);
    }
  });

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
    content: "Typing...",
    sender: "assistant",
    timestamp,
    loader: true,
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
      loader: false,
    };
    document.getElementById("loading-message").remove();
    messages.push(botMessage);
    renderMessage(botMessage);
  } catch (error) {
    const botMessage = {
      id: messages.length + 1,
      content: "Error fetching response!",
      sender: "assistant",
      timestamp: new Date().toISOString(),
    };
    document.getElementById("loading-message").remove();
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
  renderSuggestions();
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
    content: "Forwarding your request to an expert for review..",
    sender: "assistant",
    timestamp,
    loader: true,
  };
  renderMessage(loadingMessage);
  fetch("/ask-expert", { method: "POST" })
    .then((response) => response.json())
    .then((data) => {
      const newTimestamp = new Date().toISOString();
      const responseMessage = {
        id: messages.length + 1,
        content:
          "Your request has been successfully sent to an expert! You'll receive a response soon.",
        sender: "assistant",
        timestamp: newTimestamp,
        loader: false,
      };
      document.getElementById("loading-message").remove();
      renderMessage(responseMessage);
    })
    .then((data) => alert(data.message));
});

if (SpeechRecognition) {
  const recognition = new SpeechRecognition();
  recognition.interimResults = false;
  recognition.lang = "en-US";

  voiceButton.addEventListener("click", () => {
    messageInput.focus();
    recognition.start();
  });

  // When the mic starts recording:
  recognition.addEventListener("start", () => {
    voiceButton.classList.add("recording");
  });

  // When the mic stops recording:
  recognition.addEventListener("end", () => {
    voiceButton.classList.remove("recording");
  });

  recognition.addEventListener("result", (event) => {
    const transcript = event.results[0][0].transcript;
    messageInput.value += (messageInput.value ? " " : "") + transcript;
    voiceButton.style.display = "none";
    messageInput.dispatchEvent(new Event('input'));
  });
} else {
  console.warn("Speech Recognition not supported in this browser.");
  voiceButton.style.display = "none";
}

// Define your suggestion queries
const suggestions = [
  "What guidelines ensure merchanting transactions comply with FX and trade policies?",
  "How did the 20:80 principle shape India's gold trade, and what changed after its withdrawal?",
  "What provisions enforce timely evidence submission and accountability?"
];

function renderSuggestions() {
  const suggestionsList = document.getElementById("suggestionsList");
  suggestionsList.innerHTML = '';
  suggestions.forEach(suggestion => {
    const suggestionDiv = document.createElement("div");
    suggestionDiv.className = "suggestion-card";
    suggestionDiv.innerHTML = `
      <span class="suggestion-text">${suggestion}</span>
      <button class="suggestion-arrow">
        <i class="fa fa-arrow-right"></i>
      </button>
    `;
    // Clicking the arrow button populates the text input with the suggestion
    suggestionDiv.querySelector(".suggestion-arrow").addEventListener("click", (e) => {
      e.stopPropagation(); // Prevent triggering parent click if any
      messageInput.value = suggestion;
      messageInput.focus();
      messageInput.dispatchEvent(new Event('input'));
    });
    suggestionsList.appendChild(suggestionDiv);
  });
}

// Listen for changes in the message input field
messageInput.addEventListener("input", () => {
  // Check if there's at least one non-whitespace character
  if (messageInput.value.trim().length > 0) {
    voiceButton.style.display = "none";
  } else {
    voiceButton.style.display = "inline-block";
  }
});

window.addEventListener("load", () => {
  // Check if the navigation type is "reload"
  const [navEntry] = performance.getEntriesByType("navigation");
  if (navEntry && navEntry.type === "reload") {
    resetChat();
  }
});


