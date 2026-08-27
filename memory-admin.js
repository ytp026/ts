"use strict";

const loginPanel = document.querySelector("#admin-login");
const workspace = document.querySelector("#admin-workspace");
const loginForm = document.querySelector("#login-form");
const memoryForm = document.querySelector("#memory-form");
const status = document.querySelector("#admin-status");
const list = document.querySelector("#admin-list");
const searchInput = document.querySelector("#admin-search");
const editorTitle = document.querySelector("#editor-title");
const saveButton = document.querySelector("#save-memory");
const cancelEdit = document.querySelector("#cancel-edit");
let adminRows = [];

function setStatus(message, type = "") {
  status.textContent = message;
  status.className = `memory-admin-status${type ? ` is-${type}` : ""}`;
}

function valueOrNull(value) {
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizePrice(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const currency = trimmed.match(/^[£$]/)?.[0] || "£";
  const amount = Number(trimmed.replace(/[£$,\s]/g, ""));
  return Number.isFinite(amount) && amount >= 0
    ? `${currency}${amount.toFixed(2)}`
    : trimmed;
}

const ratingFields = ["cast_vibe", "music_vibe", "stage_magic", "story_feel"];

function calculatedRating() {
  const scores = ratingFields
    .map((field) => Number(memoryForm.elements[field].value))
    .filter((score) => Number.isFinite(score) && score >= 1 && score <= 5);
  return scores.length
    ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2))
    : null;
}

function updateCalculatedRating() {
  memoryForm.elements.rating.value = calculatedRating() ?? "";
}

function formRecord() {
  const data = new FormData(memoryForm);
  const record = timelineColumns.reduce((record, column) => {
    if (!memoryForm.elements[column]) return record;
    const value = String(data.get(column) || "");
    record[column] = column === "rating"
      ? (value ? Number(value) : null)
      : column === "price"
        ? normalizePrice(value)
        : valueOrNull(value);
    return record;
  }, {});
  record.rating = calculatedRating();
  return record;
}

function resetEditor() {
  memoryForm.reset();
  memoryForm.elements.color.value = "#315bcf";
  memoryForm.elements.id.value = "";
  updateCalculatedRating();
  editorTitle.textContent = "Add a performance";
  saveButton.textContent = "Add performance";
  cancelEdit.hidden = true;
}

function editRow(row) {
  timelineColumns.forEach((column) => {
    if (!memoryForm.elements[column]) return;
    memoryForm.elements[column].value = column === "color"
      ? (row[column] || "#315bcf")
      : (row[column] ?? "");
  });
  updateCalculatedRating();
  memoryForm.elements.id.value = row.id;
  editorTitle.textContent = `Edit ${row.show}`;
  saveButton.textContent = "Save changes";
  cancelEdit.hidden = false;
  memoryForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteRow(row) {
  if (!window.confirm(`Remove "${row.show}" on ${row.date} from the timeline?`)) return;
  const client = getSupabaseClient();
  const { error } = await client.from("timeline_memories").delete().eq("id", row.id);
  if (error) {
    setStatus(error.message, "error");
    return;
  }
  setStatus(`Removed ${row.show}.`, "success");
  if (memoryForm.elements.id.value === row.id) resetEditor();
  await loadRows();
}

function renderRows() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  const filtered = adminRows.filter((row) => (
    !query || [row.date, row.show, row.theatre, row.city]
      .some((value) => String(value || "").toLocaleLowerCase().includes(query))
  ));
  list.replaceChildren(...filtered.map((row) => {
    const tableRow = document.createElement("tr");
    tableRow.className = "memory-admin-table-row";
    const dateCell = document.createElement("td");
    const date = document.createElement("time");
    date.dateTime = row.date;
    date.textContent = row.date;
    dateCell.appendChild(date);
    const showCell = document.createElement("td");
    showCell.className = "memory-admin-show-cell";
    showCell.textContent = row.show;
    const theatreCell = document.createElement("td");
    theatreCell.textContent = row.theatre || "-";
    const cityCell = document.createElement("td");
    cityCell.textContent = row.city || "-";
    const priceCell = document.createElement("td");
    priceCell.textContent = row.price || "-";
    const ratingCell = document.createElement("td");
    ratingCell.textContent = row.rating ? `${row.rating} / 5` : "-";
    const actionsCell = document.createElement("td");
    actionsCell.className = "memory-admin-table-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => editRow(row));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "is-danger";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => deleteRow(row));
    actionsCell.append(edit, remove);
    tableRow.append(dateCell, showCell, theatreCell, cityCell, priceCell, ratingCell, actionsCell);
    return tableRow;
  }));
  if (!filtered.length) {
    const row = document.createElement("tr");
    const message = document.createElement("td");
    message.className = "memory-admin-empty";
    message.colSpan = 7;
    message.textContent = query ? "No rows match this search." : "No timeline rows have been added.";
    row.appendChild(message);
    list.appendChild(row);
  }
}

async function loadRows() {
  try {
    adminRows = await fetchTimelineRows() || [];
    renderRows();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function showSession(session) {
  loginPanel.hidden = Boolean(session);
  workspace.hidden = !session;
  if (session) {
    setStatus(`Signed in as ${session.user.email}.`, "success");
    await loadRows();
  } else {
    setStatus("Sign in to manage timeline rows.");
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const client = getSupabaseClient();
  if (!client) {
    setStatus("Supabase is not configured yet. Add the project URL and publishable key to supabase-config.js.", "error");
    return;
  }
  const data = new FormData(loginForm);
  setStatus("Signing in...");
  const { data: authData, error } = await client.auth.signInWithPassword({
    email: String(data.get("email")),
    password: String(data.get("password"))
  });
  if (error) {
    setStatus(error.message, "error");
    return;
  }
  loginForm.reset();
  await showSession(authData.session);
});

memoryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const client = getSupabaseClient();
  const id = memoryForm.elements.id.value;
  const record = formRecord();
  setStatus(id ? "Saving changes..." : "Adding performance...");
  const request = id
    ? client.from("timeline_memories").update(record).eq("id", id)
    : client.from("timeline_memories").insert(record);
  const { error } = await request;
  if (error) {
    setStatus(error.message, "error");
    return;
  }
  setStatus(id ? `Updated ${record.show}.` : `Added ${record.show}.`, "success");
  resetEditor();
  await loadRows();
});

searchInput.addEventListener("input", renderRows);
ratingFields.forEach((field) => {
  memoryForm.elements[field].addEventListener("input", updateCalculatedRating);
});
cancelEdit.addEventListener("click", resetEditor);
document.querySelector("#new-memory").addEventListener("click", () => {
  resetEditor();
  memoryForm.scrollIntoView({ behavior: "smooth", block: "start" });
});
document.querySelector("#admin-sign-out").addEventListener("click", async () => {
  const client = getSupabaseClient();
  await client.auth.signOut();
  resetEditor();
  adminRows = [];
  await showSession(null);
});

if (!supabaseConfigured()) {
  setStatus("Setup required: configure Supabase before signing in.", "error");
} else {
  const client = getSupabaseClient();
  client.auth.getSession().then(({ data, error }) => {
    if (error) {
      setStatus(error.message, "error");
      return;
    }
    showSession(data.session);
  });
  client.auth.onAuthStateChange((_event, session) => {
    loginPanel.hidden = Boolean(session);
    workspace.hidden = !session;
  });
}
