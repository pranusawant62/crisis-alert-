function loadAlerts() {
  let data = JSON.parse(localStorage.getItem("alerts")) || [];
  let box = document.getElementById("alerts");

  box.innerHTML = "";

  if (data.length === 0) {
    box.innerHTML = "<p>No alerts received yet</p>";
    return;
  }

  data.forEach((a, index) => {
    box.innerHTML += `
      <div style="border:1px solid black; margin:10px; padding:10px;">
        <h3>${a.type}</h3>
        <p>${a.location}</p>
        <p>${a.time}</p>

        <button onclick="resolve(${index})">Resolve</button>
      </div>
    `;
  });
}

// REMOVE ALERT
function resolve(index) {
  let data = JSON.parse(localStorage.getItem("alerts")) || [];
  data.splice(index, 1);
  localStorage.setItem("alerts", JSON.stringify(data));
  loadAlerts();
}

// 🔥 VERY IMPORTANT (THIS WAS MISSING)
window.onload = loadAlerts;