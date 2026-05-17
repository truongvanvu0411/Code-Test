require_relative "../implementation"

RSpec.describe RentalCart do
  it "applies campaign discount only to new releases" do
    cart = RentalCart.new(campaign: true)

    cart.add_rental(Rental.new(Video.new("Oppenheimer", Video::NEW_RELEASE), 3))
    cart.add_rental(Rental.new(Video.new("Old Drama", Video::REGULAR), 5))

    expect(cart.total_amount).to eq(2500)
    expect(cart.total_point).to eq(3)
    expect(cart.statement).to include("Oppenheimer\t3 days\t600 JPY")
    expect(cart.statement).to include("Old Drama\t5 days\t1900 JPY")
  end

  it "rejects rental periods above 30 days" do
    cart = RentalCart.new
    video = Video.new("Long Stay", Video::REGULAR)

    expect { cart.add_rental(Rental.new(video, 31)) }.to raise_error(RentalCart::RentalPeriodError)
  end
end
