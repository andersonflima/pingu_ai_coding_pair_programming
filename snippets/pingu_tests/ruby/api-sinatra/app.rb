require 'sinatra'
require 'json'

set :port, 4567

users = [
  { id: 1, name: 'Ana', email: 'ana@exemplo.com' },
  { id: 2, name: 'Bruno', email: 'bruno@exemplo.com' }
]

get '/health' do
  content_type :json
  { status: 'ok', service: 'pingu-ruby-api' }.to_json
end

get '/users' do
  content_type :json
  users.to_json
end

post '/users' do
  payload = JSON.parse(request.body.read)
  user = users.empty? ? { id: 1 } : { id: users.last[:id] + 1 }
  user = user.merge('name' => payload['name'], 'email' => payload['email'])
  users << user
  status 201
  content_type :json
  user.to_json
end

__END__
