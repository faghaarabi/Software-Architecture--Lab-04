const API_BASE_URL = "https://software-architecture-lab-04-1.onrender.com";

/* INSERT BUTTON (POST) */
insertBtn.addEventListener("click", async () => {
    resultArea.textContent = "Inserting data...";

    try {
        const response = await fetch(`${API_BASE_URL}/lab5/api/v1/insert`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
        });

        const data = await response.json();
        resultArea.textContent = JSON.stringify(data, null, 2);
    } catch (error) {
        resultArea.textContent = "Error: " + error.message;
    }
});

/* SELECT BUTTON (GET) */
selectBtn.addEventListener("click", async () => {
    const query = sqlQuery.value.trim();
    if (!query) {
        resultArea.textContent = "Please enter a SELECT query.";
        return;
    }

    resultArea.textContent = "Running query...";

    try {
        const encodedQuery = encodeURIComponent(query);

        const response = await fetch(
            `${API_BASE_URL}/lab5/api/v1/sql?query=${encodedQuery}`,
            {
                method: "GET",
                headers: { "Accept": "application/json" },
            }
        );

        const data = await response.json();
        resultArea.textContent = JSON.stringify(data, null, 2);
    } catch (error) {
        resultArea.textContent = "Error: " + error.message;
    }
});