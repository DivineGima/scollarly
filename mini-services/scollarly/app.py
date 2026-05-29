from flask import Flask, render_template, request, jsonify, redirect
import urllib.parse

app = Flask(__name__, static_folder="static", template_folder="templates")

WHATSAPP_NUMBER = "237651232301"

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/contact", methods=["POST"])
def contact():
    name = request.form.get("name", "")
    email = request.form.get("email", "")
    phone = request.form.get("phone", "")
    message = request.form.get("message", "")

    whatsapp_msg = (
        f"Hello Scollarly!%0A%0A"
        f"*Name:* {urllib.parse.quote(name)}%0A"
        f"*Email:* {urllib.parse.quote(email)}%0A"
        f"*Phone:* {urllib.parse.quote(phone)}%0A"
        f"*Message:* {urllib.parse.quote(message)}"
    )

    whatsapp_url = f"https://wa.me/{WHATSAPP_NUMBER}?text={whatsapp_msg}"
    return jsonify({"success": True, "whatsapp_url": whatsapp_url})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
