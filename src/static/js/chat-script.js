// State management
let messages = [];
let queries = [];

// DOM Elements
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;
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
        <!-- Main text -->
        <div class="message-text">${message.content}</div>
        <!-- Time at the bottom-right (optional) -->
        <div class="message-time">${formatTime(message.timestamp)}</div>
      </div>
    `;
  }

  // For assistant messages (non-loading), add bookmark, thumbs up, and thumbs down.
  if (message.sender === "assistant" && !message.loader) {
    const buttonContainer = document.createElement("div");
    buttonContainer.className = "button-container";

    // Bookmark button (remains toggleable)
    const bookmarkButton = document.createElement("button");
    bookmarkButton.className = "icon-button bookmark-button";
    bookmarkButton.innerHTML = '<i class="fa fa-bookmark-o"></i>';
    bookmarkButton.addEventListener("click", () => {
      if (bookmarkButton.classList.contains("selected")) {
        // Already bookmarked – remove bookmark.
        removeBookmark(message);
        bookmarkButton.classList.remove("selected");
      } else {
        // Not bookmarked – add bookmark.
        bookmarkResponse(message);
        bookmarkButton.classList.add("selected");
      }
    });

    // Thumbs Up button: only select if not already selected
    const thumbsUpButton = document.createElement("button");
    thumbsUpButton.className = "icon-button bookmark-button";
    thumbsUpButton.innerHTML = '<i class="fa fa-thumbs-up"></i>';
    thumbsUpButton.addEventListener("click", () => {
      if (!thumbsUpButton.classList.contains("selected")) {
        sendFeedback(message.docId, "positive");
        thumbsUpButton.classList.add("selected");
        thumbsDownButton.classList.remove("selected");
      }
      // If already selected, do nothing.
    });

    // Thumbs Down button: only select if not already selected
    const thumbsDownButton = document.createElement("button");
    thumbsDownButton.className = "icon-button bookmark-button";
    thumbsDownButton.innerHTML = '<i class="fa fa-thumbs-down"></i>';
    thumbsDownButton.addEventListener("click", () => {
      if (!thumbsDownButton.classList.contains("selected")) {
        sendFeedback(message.docId, "negative");
        thumbsDownButton.classList.add("selected");
        thumbsUpButton.classList.remove("selected");
      }
      // If already selected, do nothing.
    });

    buttonContainer.appendChild(bookmarkButton);
    buttonContainer.appendChild(thumbsUpButton);
    buttonContainer.appendChild(thumbsDownButton);

    // Append the button container at the bottom of .message-content
    messageDiv.querySelector(".message-content").appendChild(buttonContainer);
  }

  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function removeBookmark(message) {
  // Remove the bookmarked message from the queries array.
  queries = queries.filter((q) => q.id !== message.id);

  // Clear the current bookmarks list.
  queriesList.innerHTML = "";

  // Re-render the remaining bookmarks.
  queries.forEach((q) => renderQuery(q));
}

function sendFeedback(docId, feedback) {
  fetch("/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doc_id: docId, feedback: feedback }),
  })
    .then((response) => response.json())
    .then((data) => {
      console.log(data.message); // Optionally display a confirmation message
    })
    .catch((error) => {
      console.error("Error updating feedback:", error);
    });
}

// In renderQuery, attach a click listener to scroll to the corresponding message
function renderQuery(query) {
  const queryDiv = document.createElement("div");
  queryDiv.className = "query-card";
  // Using the first line of the message for display; CSS can handle overflow styling.
  queryDiv.innerHTML = `
    <div class="query-timestamp">${formatDate(query.timestamp)}</div>
    <div class="query-content">${query.content.split("\n")[0]}</div>
  `;

  queryDiv.addEventListener("click", () => {
    const target = document.getElementById("message-" + query.id);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      // Optional: add a temporary highlight to the message
      target.classList.add("highlight");
      setTimeout(() => {
        target.classList.remove("highlight");
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
    content:
      '<span class="typing-text">Thinking</span><span class="dot">.</span><span class="dot">.</span><span class="dot">.</span>',
    sender: "assistant",
    timestamp,
    loader: true,
  };

  messages.push(message);
  renderMessage(message);
  renderMessage(loadingMessage);

  messageInput.value = "";
  messageInput.dispatchEvent(new Event("input"));

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
      docId: data.doc_id,
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
  fetchSuggestions();
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
    content:
      '<span class="typing-text">Forwarding your request to an expert for review</span><span class="dot">.</span><span class="dot">.</span><span class="dot">.</span>',
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
        content: data.message,
        sender: "assistant",
        timestamp: newTimestamp,
        loader: false,
      };
      document.getElementById("loading-message").remove();
      renderMessage(responseMessage);
    });
});

if (window.SpeechRecognition || window.webkitSpeechRecognition) {
  const recognition = new (window.SpeechRecognition ||
    window.webkitSpeechRecognition)();
  recognition.interimResults = false;
  recognition.lang = "en-US";

  voiceButton.addEventListener("click", (e) => {
    // If the button is set to submit (send mode), do nothing here
    if (voiceButton.getAttribute("type") === "submit") {
      return; // Allow the form's submit event to handle the action.
    }
    // Otherwise, in mic mode, handle voice recognition
    if (voiceButton.classList.contains("recording")) {
      recognition.stop();
    } else {
      recognition.start();
    }
  });
  

  recognition.addEventListener("start", () => {
    // Button goes into recording mode
    voiceButton.classList.add("recording");
  });

  recognition.addEventListener("end", () => {
    // Button stops recording mode
    voiceButton.classList.remove("recording");
  });

  recognition.addEventListener("result", (event) => {
    const transcript = event.results[0][0].transcript;
    messageInput.value += (messageInput.value ? " " : "") + transcript;
    // Force the icon to update to "send" if text is present
    messageInput.dispatchEvent(new Event("input"));
  });
} else {
  // Fallback if SpeechRecognition is not supported
  voiceButton.style.display = "none";
}

// Define your suggestion queries
let suggestions = [];

function fetchSuggestions() {
  fetch("/suggestions")
    .then((response) => response.json())
    .then((data) => {
      suggestions = data.suggestions;
      renderSuggestions(); // update your UI with the fetched suggestions
    })
    .catch((error) => console.error("Error fetching suggestions:", error));
}

function renderSuggestions() {
  const suggestionsList = document.getElementById("suggestionsList");
  suggestionsList.innerHTML = "";
  suggestions.forEach((suggestion) => {
    const suggestionDiv = document.createElement("div");
    suggestionDiv.className = "suggestion-card";
    suggestionDiv.innerHTML = `
      <span class="suggestion-text">${suggestion}</span>
      <button class="suggestion-arrow">
        <i class="fa fa-arrow-right"></i>
      </button>
    `;
    // Clicking the arrow button populates the text input with the suggestion
    suggestionDiv
      .querySelector(".suggestion-arrow")
      .addEventListener("click", (e) => {
        e.stopPropagation(); // Prevent triggering parent click if any
        messageInput.value = suggestion;
        messageInput.focus();
        messageInput.dispatchEvent(new Event("input"));
      });
    suggestionsList.appendChild(suggestionDiv);
  });
}

// 1. Define your mic and up-arrow icons as strings
const micIcon = `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" 
     viewBox="0 0 16 16">
  <path d="M8 10a2 2 0 0 0 2-2V4a2 2 0 1 
           0-4 0v4a2 2 0 0 0 2 2z" />
  <path d="M3 7a5 5 0 0 0 10 0h1a6 6 0 
           0 1-5 5.917V15H7v-2.083A6 6 0 
           0 1 2 7h1z" />
</svg>`;

const upArrowIcon = `
<svg
  xmlns="http://www.w3.org/2000/svg"
  width="34"
  height="34"
  viewBox="0 0 24 24"
>
  <circle cx="12" cy="12" r="10" fill="currentColor"/>
  <path d="M12 8 L16 12 H13 V16 H11 V12 H8 L12 8 Z" fill="#fff"/>
</svg>`;

// 2. Listen for input changes
messageInput.addEventListener("input", () => {
  const hasText = messageInput.value.trim().length > 0;

  if (hasText) {
    // Switch to up-arrow (submit)
    voiceButton.innerHTML = upArrowIcon;
    voiceButton.title = "Send";
    voiceButton.setAttribute("type", "submit");
  } else {
    // Switch back to mic
    voiceButton.innerHTML = micIcon;
    voiceButton.title = "Speak";
    voiceButton.setAttribute("type", "button");
  }
});

window.addEventListener("load", () => {
  // Check if the navigation type is "reload"
  const [navEntry] = performance.getEntriesByType("navigation");
  if (navEntry && navEntry.type === "reload") {
    resetChat();
  }
});

document
  .getElementById("downloadPdfButton")
  .addEventListener("click", async () => {
    const timestamp = new Date().toISOString();
    try {
      const response = await fetch("/download-pdf");
      const contentType = response.headers.get("Content-Type");

      if (contentType && contentType.includes("application/json")) {
        // The backend returned a JSON error message (no conversation found)
        const data = await response.json();
        const responseMessage = {
          id: messages.length + 1,
          content: data.message,
          sender: "assistant",
          timestamp,
          loader: false,
        };
        renderMessage(responseMessage);
      } else if (contentType && contentType.includes("application/pdf")) {
        // The backend returned a PDF; proceed to download it
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "conversation.pdf";
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        const responseMessage = {
          id: messages.length + 1,
          content: "PDF downloaded successfully!",
          sender: "assistant",
          timestamp,
          loader: false,
        };
        renderMessage(responseMessage);
      } else {
        const responseMessage = {
          id: messages.length + 1,
          content: "An error occurred while downloading the PDF.",
          sender: "assistant",
          timestamp,
          loader: false,
        };
        renderMessage(responseMessage);
      }
    } catch (error) {
      console.error(error);
      const responseMessage = {
        id: messages.length + 1,
        content: "An error occurred while downloading the PDF.",
        sender: "assistant",
        timestamp,
        loader: false,
      };
      renderMessage(responseMessage);
    }
  });
