require_relative "../implementation"

RSpec.describe PropertyCommissionEngine do
  it "settles a co-broker commercial deal for a lead agent" do
    result = described_class.new(
      { price: 2_000_000, property_type: "commercial", co_broker: true, referral: false },
      { agent_level: "lead", marketing_spend: 5000 }
    ).call

    expect(result[:gross_commission]).to eq(25000.0)
    expect(result[:agent_commission]).to eq(18750.0)
    expect(result[:referral_fee]).to eq(0)
    expect(result[:company_commission]).to eq(6250.0)
    expect(result[:company_final]).to eq(1375.0)
    expect(result[:audit_log]).to include("co broker split")
  end
end
