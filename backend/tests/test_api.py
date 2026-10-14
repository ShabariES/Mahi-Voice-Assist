import sys, os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_root():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["status"] == "online"

def test_login_and_auth():
    # Login as default seeded user
    res = client.post("/api/auth/login", json={
        "email": "user@voiceform.com",
        "password": "user123"
    })
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["user"]["email"] == "user@voiceform.com"

def test_form_and_session_flow():
    # 1. Login
    login_res = client.post("/api/auth/login", json={
        "email": "user@voiceform.com",
        "password": "user123"
    })
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Get Forms
    forms_res = client.get("/api/forms", headers=headers)
    assert forms_res.status_code == 200
    forms = forms_res.json()
    assert len(forms) >= 1
    form_id = forms[0]["id"]

    # 3. Start Session
    session_res = client.post("/api/sessions", json={"form_id": form_id}, headers=headers)
    assert session_res.status_code == 200
    session_data = session_res.json()
    session_id = session_data["id"]
    assert session_data["current_field"] == 1
    assert session_data["current_question"] == "What is your first name?"

    # 4. Answer First Name ("My name is John")
    ans1 = client.post(f"/api/sessions/{session_id}/answer", json={"answer": "My name is John"}, headers=headers)
    assert ans1.status_code == 200
    assert ans1.json()["success"] is True
    assert ans1.json()["answer"] == "John"
    assert ans1.json()["current_field"] == 2

    # 5. Answer Last Name ("Doe")
    ans2 = client.post(f"/api/sessions/{session_id}/answer", json={"answer": "Doe"}, headers=headers)
    assert ans2.status_code == 200
    assert ans2.json()["success"] is True
    assert ans2.json()["current_field"] == 3

    # 6. Test Email Validation (invalid first)
    bad_email = client.post(f"/api/sessions/{session_id}/answer", json={"answer": "not an email"}, headers=headers)
    assert bad_email.status_code == 200
    assert bad_email.json()["success"] is False
    assert "valid email" in bad_email.json()["error"].lower()

    # 7. Valid Email ("john at gmail dot com")
    good_email = client.post(f"/api/sessions/{session_id}/answer", json={"answer": "john at gmail dot com"}, headers=headers)
    assert good_email.status_code == 200
    assert good_email.json()["success"] is True
    assert good_email.json()["answer"] == "john@gmail.com"
    assert good_email.json()["current_field"] == 4

    # 8. Phone ("My phone number is 9876543210")
    phone_res = client.post(f"/api/sessions/{session_id}/answer", json={"answer": "My phone number is 9876543210"}, headers=headers)
    assert phone_res.status_code == 200
    assert phone_res.json()["answer"] == "9876543210"
    assert phone_res.json()["current_field"] == 5

    # 9. Employment Status Choice ("I am working as a software developer" -> employed)
    emp_res = client.post(f"/api/sessions/{session_id}/answer", json={"answer": "I'm currently working as a software developer."}, headers=headers)
    assert emp_res.status_code == 200
    assert emp_res.json()["answer"].lower() == "employed"
    assert emp_res.json()["current_field"] == 6

    # 10. Years Experience Number ("five")
    exp_res = client.post(f"/api/sessions/{session_id}/answer", json={"answer": "five"}, headers=headers)
    assert exp_res.status_code == 200
    assert exp_res.json()["answer"] == "5"
    assert exp_res.json()["current_field"] == 7

    # 11. Currently Employed Yes/No ("Of course")
    yes_res = client.post(f"/api/sessions/{session_id}/answer", json={"answer": "Of course"}, headers=headers)
    assert yes_res.status_code == 200
    assert yes_res.json()["answer"] == "true"
    assert yes_res.json()["completed"] is True

    # 12. Check answers review endpoint
    review_res = client.get(f"/api/sessions/{session_id}/answers", headers=headers)
    assert review_res.status_code == 200
    answers = review_res.json()["answers"]
    assert len(answers) == 7
    print("ALL API & ANSWER PROCESSING TESTS PASSED!")

if __name__ == "__main__":
    test_root()
    test_login_and_auth()
    test_form_and_session_flow()
