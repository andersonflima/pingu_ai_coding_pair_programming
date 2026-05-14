from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    response = client.get('/health')
    assert response.status_code == 200
    assert response.json()['status'] == 'ok'


def test_create_user():
    response = client.post('/users', json={"name": "Carla", "email": "carla@exemplo.com"})
    assert response.status_code == 201
    assert response.json()['name'] == 'Carla'
