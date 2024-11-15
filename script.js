// Global variables
let smsData = {};
let filteredContacts = {};
let darkModeEnabled = false;

// DOM Elements
const fileInput = document.getElementById("file-input");
const uploadArea = document.getElementById("upload-area");
const contactList = document.getElementById("contact-list");
const chatWindow = document.getElementById("chat-window");
const searchBarContainer = document.getElementById("search-bar-container");
const conversationSearch = document.getElementById("conversation-search");
const contactFilter = document.getElementById("contact-filter");
const darkModeToggle = document.getElementById("dark-mode-toggle");

// Event Listeners
uploadArea.addEventListener("click", () => fileInput.click());
uploadArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadArea.classList.add("bg-secondary", "text-white");
});
uploadArea.addEventListener("dragleave", () => {
    uploadArea.classList.remove("bg-secondary", "text-white");
});
uploadArea.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadArea.classList.remove("bg-secondary", "text-white");
    const file = e.dataTransfer.files[0];
    handleFile(file);
});
fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    handleFile(file);
});

function handleFile(file) {
    if (file && file.type === "text/xml") {
        const reader = new FileReader();
        reader.onload = (e) => {
            parseXML(e.target.result);
        };
        reader.readAsText(file);
    } else {
        alert("Please upload a valid XML file.");
    }
}


document.getElementById("export-csv").addEventListener("click", exportCSV);
document.getElementById("export-pdf").addEventListener("click", exportPDF);
document.getElementById("export-json").addEventListener("click", exportJSON);

document.getElementById("toggle-search").addEventListener("click", () => {
    const searchBarContainer = document.getElementById("search-bar-container");

    if (searchBarContainer.classList.contains("search-bar-collapsed")) {
        searchBarContainer.classList.remove("search-bar-collapsed");
        searchBarContainer.classList.add("search-bar-expanded");
    } else {
        searchBarContainer.classList.remove("search-bar-expanded");
        searchBarContainer.classList.add("search-bar-collapsed");
    }
});

document.getElementById("conversation-search").addEventListener("input", (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const messages = document.querySelectorAll("#chat-window .card");

    messages.forEach((msg) => {
        const body = msg.querySelector(".card-body").textContent.toLowerCase();
        msg.style.display = body.includes(searchTerm) ? "block" : "none";
    });
});



conversationSearch.addEventListener("input", filterMessages);
contactFilter.addEventListener("change", applyContactFilter);

darkModeToggle.addEventListener("click", toggleDarkMode);

// Handle File Upload
function handleFile(file) {
    if (file && file.type === "text/xml") {
        const reader = new FileReader();
        reader.onload = (e) => {
            parseXML(e.target.result);
        };
        reader.readAsText(file);
    } else {
        alert("Please upload a valid XML file.");
    }
}


// Normalize phone numbers
function normalizePhoneNumber(phone) {
    // Entferne Leerzeichen, Bindestriche und andere Sonderzeichen
    phone = phone.replace(/[\s-()]/g, "");

    // Entferne internationale Vorwahlen
    if (phone.startsWith("+")) {
        phone = phone.replace(/^\+\d+/, ""); // Entfernt "+[Ländervorwahl]"
    } else if (phone.startsWith("00")) {
        phone = phone.replace(/^00\d+/, ""); // Entfernt "00[Ländervorwahl]"
    } else if (phone.startsWith("0")) {
        phone = phone.replace(/^0/, ""); // Entfernt führende "0" (z. B. lokale Vorwahl)
    }

    // Gib die Nummer ohne Vorwahl zurück
    return phone;
}


// Parse XML File
function parseXML(xmlString) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "text/xml");
    const messages = xmlDoc.getElementsByTagName("sms");

    smsData = {};

    Array.from(messages).forEach((msg) => {
        let address = msg.getAttribute("address");
        address = normalizePhoneNumber(address); // Normalisiere die Telefonnummer

        const readableDate = msg.getAttribute("readable_date");
        const body = msg.getAttribute("body");
        const type = msg.getAttribute("type"); // 1 = Received, 2 = Sent

        if (!smsData[address]) {
            smsData[address] = { name: msg.getAttribute("contact_name") || "Unknown", messages: [] };
        }

        smsData[address].messages.push({ readableDate, body, type });
    });

    console.log("Parsed SMS Data with Normalized Numbers:", smsData);
    populateContactList();
}



document.getElementById("contact-search").addEventListener("input", (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const contacts = document.querySelectorAll("#contact-list .list-group-item");

    contacts.forEach((contact) => {
        const contactName = contact.textContent.toLowerCase();
        contact.style.display = contactName.includes(searchTerm) ? "block" : "none";
    });
});

function displayMessages(address) {
    chatWindow.innerHTML = "";

    if (!smsData[address]) return;

    smsData[address].messages.forEach((msg) => {
        const messageDiv = document.createElement("div");
        messageDiv.className = `d-flex ${
            msg.type === "1" ? "justify-content-start" : "justify-content-end"
        } mb-2`;

        const card = document.createElement("div");
        card.className = `card ${
            msg.type === "1" ? "incoming" : "outgoing"
        }`;
        card.style.maxWidth = "60%";

        const cardBody = document.createElement("div");
        cardBody.className = "card-body";
        cardBody.textContent = msg.body;

        const cardFooter = document.createElement("div");
        cardFooter.className = "card-footer text-muted small";
        cardFooter.textContent = msg.readableDate;

        card.appendChild(cardBody);
        card.appendChild(cardFooter);
        messageDiv.appendChild(card);
        chatWindow.appendChild(messageDiv);
    });

    chatWindow.scrollTop = chatWindow.scrollHeight;
}


// Populate Contacts in Sidebar
function populateContacts() {
    contactList.innerHTML = "";

    for (const [address, data] of Object.entries(filteredContacts)) {
        const listItem = document.createElement("li");
        listItem.className = "list-group-item list-group-item-action";
        listItem.textContent = `${data.name} (${address})`;
        listItem.addEventListener("click", () => displayMessages(address));
        contactList.appendChild(listItem);
    }
}

function populateContactList() {
    contactList.innerHTML = "";

    Object.entries(smsData).forEach(([address, data]) => {
        const listItem = document.createElement("li");
        listItem.className = "list-group-item";
        listItem.textContent = `${data.name} (${address})`;
        listItem.addEventListener("click", () => displayMessages(address));
        contactList.appendChild(listItem);
    });
}


// Display Messages in Chat Window
function displayStatistics() {
    const stats = calculateStatistics();
    console.log("Displaying Statistics:", stats);

    const topContacts = calculateTopContacts(stats);
    console.log("Top Contacts:", topContacts);

    // Statistiken über Nachrichten anzeigen
    const statsContainer = document.getElementById("stats-container");
    if (!statsContainer) {
        console.error("Stats container not found!");
        return;
    }
    statsContainer.innerHTML = stats
        .map(
            (stat) => `
        <div class="stat-item">
            <h5>${stat.contact} (${stat.address})</h5>
            <p>Total Messages: ${stat.totalMessages}</p>
            <p>Sent: ${stat.sentMessages}, Received: ${stat.receivedMessages}</p>
            <p>Longest Message: ${stat.longestMessage} characters</p>
            <p>Shortest Message: ${stat.shortestMessage} characters</p>
        </div>`
        )
        .join("");

    // Top-Kontakte anzeigen
    const topContactsContainer = document.getElementById("top-contacts-container");
    if (!topContactsContainer) {
        console.error("Top contacts container not found!");
        return;
    }
    topContactsContainer.innerHTML = topContacts
        .map(
            (contact) => `
        <div class="top-contact-item">
            <h5>${contact.contact} (${contact.address})</h5>
            <p>Total Messages: ${contact.totalMessages}</p>
        </div>`
        )
        .join("");

}



// Filter Messages in Conversation
function filterMessages() {
    const searchTerm = conversationSearch.value.toLowerCase();
    const messages = document.querySelectorAll("#chat-window .card");

    messages.forEach((msg) => {
        const body = msg.querySelector(".card-body").textContent.toLowerCase();
        msg.style.display = body.includes(searchTerm) ? "block" : "none";
    });
}

// Apply Contact Filter
function applyContactFilter() {
    const filter = contactFilter.value;

    if (filter === "all") {
        filteredContacts = { ...smsData };
    } else if (filter === "named") {
        filteredContacts = Object.fromEntries(
            Object.entries(smsData).filter(([_, data]) => data.name !== "(Unknown)")
        );
    } else if (filter === "unknown") {
        filteredContacts = Object.fromEntries(
            Object.entries(smsData).filter(([_, data]) => data.name === "(Unknown)")
        );
    }

    populateContacts();
}

// Export Functions
function exportCSV() {
    const csvContent = "data:text/csv;charset=utf-8," + generateCSVContent();
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "conversation.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

async function exportPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Finde den ausgewählten Kontakt
    const selectedContact = document.querySelector("#contact-list .list-group-item.active");
    if (!selectedContact) {
        alert("Please select a contact to export messages.");
        return;
    }

    const address = selectedContact.textContent.match(/\((.*?)\)/)?.[1]; // Extrahiere die Nummer
    const contactName = smsData[address]?.name || "Unknown";

    // Setze Titel und Kontaktinformationen
    doc.setFontSize(18);
    doc.text("Message Conversation", 10, 10);
    doc.setFontSize(12);
    doc.text(`Contact: ${contactName}`, 10, 20);
    doc.text(`Number: ${address}`, 10, 30);

    let y = 40;
    doc.setFontSize(10);

    // Exportiere die Nachrichten des ausgewählten Kontakts
    smsData[address].messages.forEach((msg, index) => {
        const messageType = msg.type === "1" ? "Received" : "Sent";
        const sender = messageType === "Received" ? contactName : "You";
        const receiver = messageType === "Received" ? "You" : contactName;

        // Nachrichtentitel
        const messageHeader = `${index + 1}. ${messageType} (${msg.readableDate})`;
        const messageSenderReceiver = `From: ${sender}    To: ${receiver}`;
        const splitMessage = doc.splitTextToSize(msg.body, 180);

        // Füge die Nachricht hinzu
        doc.setTextColor(100);
        doc.text(messageHeader, 10, y);
        y += 6;

        doc.text(messageSenderReceiver, 10, y);
        y += 6;

        doc.setTextColor(50);
        splitMessage.forEach((line) => {
            doc.text(line, 10, y);
            y += 6;
        });

        y += 4;

        if (y > 270) {
            doc.addPage();
            y = 10;
        }
    });

    // Speichere das PDF mit dem Namen des Kontakts oder der Nummer
    const fileName = `Messages_${contactName !== "Unknown" ? contactName : address}.pdf`;
    doc.save(fileName);
}





function exportJSON() {
    const jsonContent = "data:application/json;charset=utf-8," + JSON.stringify(smsData);
    const encodedUri = encodeURI(jsonContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "conversation.json");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function generateCSVContent() {
    let csv = "Name,Phone,Date,Message\n";
    for (const [address, data] of Object.entries(smsData)) {
        data.messages.forEach((msg) => {
            csv += `${data.name},${address},${msg.readableDate},"${msg.body.replace(
                /"/g,
                '""'
            )}"\n`;
        });
    }
    return csv;
}

// Toggle Dark Mode
function toggleDarkMode() {
    const isDarkMode = document.body.classList.toggle("dark-mode");

    // Load or unload the dark mode CSS file dynamically
    if (isDarkMode) {
        loadDarkModeCSS();
    } else {
        unloadDarkModeCSS();
    }

    darkModeToggle.textContent = isDarkMode ? "☀️ Light Mode" : "🌙 Dark Mode";
    localStorage.setItem("darkMode", isDarkMode);
}

// Load Dark Mode CSS
function loadDarkModeCSS() {
    const darkModeLink = document.createElement("link");
    darkModeLink.rel = "stylesheet";
    darkModeLink.href = "dark-mode.css";
    darkModeLink.id = "dark-mode-styles";
    document.head.appendChild(darkModeLink);
}

// Unload Dark Mode CSS
function unloadDarkModeCSS() {
    const darkModeLink = document.getElementById("dark-mode-styles");
    if (darkModeLink) {
        darkModeLink.remove();
    }
}

// Apply Dark Mode on Load
if (localStorage.getItem("darkMode") === "true") {
    document.body.classList.add("dark-mode");
    loadDarkModeCSS();
    darkModeToggle.textContent = "☀️ Light Mode";
}

