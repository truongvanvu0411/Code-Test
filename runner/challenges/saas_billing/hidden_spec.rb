require_relative "../implementation"

RSpec.describe BillingEngine do
  it "caps referral credit before tax" do
    result = described_class.new(
      "ACC-LOW",
      "basic",
      [],
      { seats: 0, billing_cycle: "annual", referral_active: true, region: "global" }
    ).call

    expect(result[:subtotal]).to eq(29.0)
    expect(result[:item_discount]).to eq(4.35)
    expect(result[:membership_discount]).to eq(24.65)
    expect(result[:tax]).to eq(0.0)
    expect(result[:final_total]).to eq(0.0)
  end

  it "charges enterprise seats and dedicated support without warnings" do
    result = described_class.new(
      "ACC-ENT",
      "enterprise",
      [{ storage_gb: 900, api_calls: 8_000 }],
      { seats: 120, support_tier: "dedicated", billing_cycle: "monthly", region: "na-us" }
    ).call

    expect(result[:subtotal]).to eq(5069.0)
    expect(result[:tax]).to eq(380.18)
    expect(result[:final_total]).to eq(5449.18)
    expect(result[:warn]).to be_nil
  end
end
