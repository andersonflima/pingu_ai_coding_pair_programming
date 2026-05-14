require 'json'
require_relative 'spec_helper'

RSpec.describe 'Pingu Ruby API' do
  include Rack::Test::Methods

  def app
    Sinatra::Application
  end

  it 'returns health' do
    get '/health'
    expect(last_response).to be_ok
    expect(JSON.parse(last_response.body)['status']).to eq('ok')
  end
end
