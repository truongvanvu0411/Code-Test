require "fileutils"
require "json"
require "open3"
require "securerandom"
require "sinatra/base"
require "timeout"

class RunnerApp < Sinatra::Base
  set :bind, "0.0.0.0"
  set :port, 4567
  set :protection, except: :host_authorization
  set :host_authorization, { permitted_hosts: [] }

  CHALLENGE_IDS = %w[
    rental_cart
    checkout_calculator
    saas_billing
    insurance_premium
    payroll_adjustment
    airline_fare
    property_commission
    warehouse_fulfillment
    hospital_invoice
    loan_payoff
  ].freeze
  MAX_PAYLOAD_BYTES = 200_000
  RUN_TIMEOUT_SECONDS = 10

  before do
    content_type :json
  end

  get "/health" do
    { ok: true }.to_json
  end

  post "/run" do
    payload = JSON.parse(request.body.read)
    challenge_id = payload.fetch("challengeId")
    halt 404, { error: "Unknown challenge" }.to_json unless CHALLENGE_IDS.include?(challenge_id)

    implementation = payload.fetch("implementationCode").to_s
    visible_spec = payload.fetch("visibleSpecCode").to_s

    if implementation.bytesize > MAX_PAYLOAD_BYTES || visible_spec.bytesize > MAX_PAYLOAD_BYTES
      halt 413, { error: "Payload too large" }.to_json
    end

    run_id = SecureRandom.hex(8)
    workspace = File.join(Dir.tmpdir, "refactorsim-#{run_id}")

    begin
      FileUtils.mkdir_p(File.join(workspace, "spec"))
      File.write(File.join(workspace, "implementation.rb"), implementation)
      File.write(File.join(workspace, "spec", "visible_spec.rb"), visible_spec)
      FileUtils.cp(
        File.join(settings.root, "challenges", challenge_id, "hidden_spec.rb"),
        File.join(workspace, "spec", "hidden_spec.rb")
      )

      visible = run_rspec(workspace, "spec/visible_spec.rb")
      hidden = run_rspec(workspace, "spec/hidden_spec.rb")

      {
        status: visible[:passed] && hidden[:passed] ? "passed" : "failed",
        visiblePassed: visible[:passed],
        hiddenPassed: hidden[:passed],
        visibleOutput: visible[:output],
        hiddenSummary: hidden[:summary],
        failures: visible[:failures],
        durationMs: visible[:duration_ms] + hidden[:duration_ms],
        scoreSignals: {
          visibleExamples: visible[:examples],
          hiddenExamples: hidden[:examples],
          visibleFailures: visible[:failure_count],
          hiddenFailures: hidden[:failure_count]
        }
      }.to_json
    rescue JSON::ParserError
      halt 400, { error: "Invalid JSON payload" }.to_json
    rescue KeyError => error
      halt 400, { error: "Missing field: #{error.key}" }.to_json
    ensure
      FileUtils.rm_rf(workspace) if workspace && Dir.exist?(workspace)
    end
  end

  def run_rspec(workspace, spec_path)
    json_path = File.join(workspace, "rspec.json")
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    command = ["rspec", spec_path, "--format", "json", "--out", json_path, "--format", "progress"]

    stdout = +""
    stderr = +""
    status = nil
    timed_out = false

    Dir.chdir(workspace) do
      begin
        Timeout.timeout(RUN_TIMEOUT_SECONDS) do
          stdout, stderr, status = Open3.capture3(*command)
        end
      rescue Timeout::Error
        timed_out = true
      end
    end

    duration_ms = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000).round
    parsed = File.exist?(json_path) ? JSON.parse(File.read(json_path)) : {}
    examples = parsed.fetch("examples", [])
    failure_count = parsed.dig("summary", "failure_count") || (timed_out ? 1 : 0)
    example_count = parsed.dig("summary", "example_count") || 0
    failures = examples
      .select { |example| example["status"] == "failed" }
      .map do |example|
        exception = example["exception"] || {}
        {
          description: example["full_description"],
          message: exception["message"].to_s.lines.first.to_s.strip
        }
      end

    output = [stdout, stderr].reject(&:empty?).join("\n")
    output = "RSpec timed out after #{RUN_TIMEOUT_SECONDS}s" if timed_out
    output = output[-12_000, 12_000] || output

    {
      passed: !timed_out && status&.success?,
      output: output,
      summary: {
        examples: example_count,
        failures: failure_count,
        timedOut: timed_out
      },
      failures: failures,
      examples: example_count,
      failure_count: failure_count,
      duration_ms: duration_ms
    }
  end

  run! if app_file == $PROGRAM_NAME
end
