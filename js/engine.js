function generateBuild() {
  const budget = Number(document.getElementById("budget").value);
  const useCase = document.getElementById("useCase").value;
  const output = document.getElementById("output");

  let cpu, gpu;

  if (useCase === "minecraft" || useCase === "roblox") {
    cpu = "Ryzen 5 5600";
    gpu = "RTX 3060";
  } else if (useCase === "gaming") {
    cpu = "Ryzen 7 5800X3D";
    gpu = "RTX 4070";
  } else {
    cpu = "Ryzen 5 5600G";
    gpu = "Integrated Graphics";
  }

  output.innerHTML = `
    <strong>CPU:</strong> ${cpu}<br>
    <strong>GPU:</strong> ${gpu}<br>
    <strong>Estimated Budget:</strong> $${budget}<br><br>
    <em>This is a placeholder logic. Real compatibility + pricing engine coming next.</em>
  `;
}
