require_relative "../implementation"

RSpec.describe WarehouseFulfillmentEngine do
  it "handles same-day cold fragile order without account discounts" do
    result = described_class.new(
      [
        {
          sla: "same_day",
          distance_km: 30,
          items: [
            { quantity: 1, weight: 10, fragile: true, temperature: "cold", value: 1000 },
            { quantity: 5, weight: 1, fragile: false, temperature: "ambient", value: 50 }
          ]
        }
      ],
      { monthly_volume: 100, priority_client: false }
    ).call

    expect(result[:handling_fee]).to eq(25.5)
    expect(result[:insurance_fee]).to eq(10.5)
    expect(result[:sla_fee]).to eq(28.0)
    expect(result[:distance_fee]).to eq(0)
    expect(result[:final_total]).to eq(69.12)
  end
end
