document.addEventListener("DOMContentLoaded", function() {
    document.getElementById("tryWithoutLogin").addEventListener("click", function(event) {
        event.preventDefault();
        window.location.href = "/chat";
    });
});
