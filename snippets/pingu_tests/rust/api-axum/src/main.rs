use actix_web::{get, post, web, App, HttpResponse, HttpServer, Responder};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone)]
struct User {
    id: u32,
    name: String,
    email: String,
}

#[derive(Deserialize)]
struct UserPayload {
    name: String,
    email: String,
}

fn users() -> web::Data<Vec<User>> {
    web::Data::new(vec![
        User {
            id: 1,
            name: "Ana".into(),
            email: "ana@exemplo.com".into(),
        },
        User {
            id: 2,
            name: "Bruno".into(),
            email: "bruno@exemplo.com".into(),
        },
    ])
}

#[get("/health")]
async fn health() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "ok",
        "service": "pingu-rust-api"
    }))
}

#[get("/users")]
async fn list_users(store: web::Data<Vec<User>>) -> impl Responder {
    HttpResponse::Ok().json(store.as_ref())
}

#[post("/users")]
async fn create_user(payload: web::Json<UserPayload>) -> impl Responder {
    let mut user = payload.into_inner();
    let response = serde_json::json!({
        "id": 3,
        "name": user.name,
        "email": user.email,
    });

    HttpResponse::Created().json(response)
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let store = users();

    HttpServer::new(move || {
        App::new()
            .app_data(store.clone())
            .service(health)
            .service(list_users)
            .service(create_user)
    })
    .bind(("127.0.0.1", 8081))?
    .run()
    .await
}
