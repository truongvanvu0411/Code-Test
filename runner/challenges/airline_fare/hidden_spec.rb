require_relative "../implementation"

RSpec.describe AirlineFareEngine do
  it "prices first class international peak travel without extra bags" do
    result = described_class.new(
      [{ base: 300, distance: 4000, cabin: "first", peak: true, international: true }],
      1,
      { bags: 1, seat_selection: false, loyalty: "silver", promo: "NONE" }
    ).call

    expect(result[:fare_subtotal]).to eq(1617.48)
    expect(result[:baggage_fee]).to eq(0.0)
    expect(result[:loyalty_discount]).to eq(64.7)
    expect(result[:tax]).to eq(108.69)
    expect(result[:airport_fee]).to eq(18.0)
    expect(result[:final_total]).to eq(1679.47)
  end
end
