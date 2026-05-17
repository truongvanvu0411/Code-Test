require_relative "../implementation"

RSpec.describe PayrollAdjustmentEngine do
  it "excludes contractors from benefits outside december" do
    result = described_class.new(
      [
        { hourly_rate: 20, hours: 42, role: "manager", weekend_shifts: 1, bonuses: [100], contractor: false },
        { hourly_rate: 60, hours: 10, role: "consultant", weekend_shifts: 0, bonuses: [300], contractor: true }
      ],
      { month: "may", region: "vn" }
    ).call

    expect(result[:gross]).to eq(2045.0)
    expect(result[:holiday_allowance]).to eq(0)
    expect(result[:benefits]).to eq(91.6)
    expect(result[:tax]).to eq(204.5)
    expect(result[:net_pay]).to eq(1748.9)
  end
end
