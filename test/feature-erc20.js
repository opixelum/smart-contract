const { expect } = require('chai');

const provider = ethers.provider;
let erc20Mock, featureERC20, feature, arbitrator;
let deployer;
let contractAsSignerDeployer;

const createSigner = async () => {
  // Get a new signer
  signer = ethers.Wallet.createRandom();
  // add the provider from Hardhat
  signer = signer.connect(ethers.provider);
  // send ETH to the new wallet so it can perform a tx
  await deployer.sendTransaction({
    to: signer.address,
    value: ethers.utils.parseEther('1000'),
  });

  return signer;
};

beforeEach(async function () {
  // Get the ContractFactory and Signers here.
  const ERC20Mock = await ethers.getContractFactory('ERC20Mock');
  const FeatureERC20 = await ethers.getContractFactory('FeatureERC20');
  const CentralizedArbitrator = await ethers.getContractFactory(
    'CentralizedAppealableArbitrator',
  );

  [deployer] = await ethers.getSigners();

  featureERC20 = await FeatureERC20.deploy();
  arbitrator = await CentralizedArbitrator.deploy('20000000000000000', '42'); // 0.02 ether, 42s
  erc20Mock = await ERC20Mock.deploy();

  await erc20Mock.deployed();
  await featureERC20.deployed();
  await arbitrator.deployed();

  contractAsSignerERC20Deployer = erc20Mock.connect(deployer);
  contractAsSignerDeployer = featureERC20.connect(deployer);
  contractAsSignerJuror = arbitrator.connect(deployer);

  const initializeTx = await contractAsSignerDeployer.initialize();
});

describe('Feature ERC20', function () {
  it('Should pay the receiver after a claim and a payment', async function () {
    const sender = await createSigner();
    const receiver = await createSigner();
    const contractAsSenderERC20Deployer = erc20Mock.connect(sender);
    const contractAsSignerSender = featureERC20.connect(sender);
    const contractAsSignerReceiver = featureERC20.connect(receiver);

    const createTransferTx = await contractAsSignerERC20Deployer.transfer(
      sender.address,
      100,
    );

    expect(await erc20Mock.balanceOf(sender.address)).to.equal(100);

    const createAllowERC20Tx = await contractAsSenderERC20Deployer.approve(
      featureERC20.address,
      100,
    );

    const createTransactionTx = await contractAsSignerSender.createTransaction(
      arbitrator.address,
      0x00,
      erc20Mock.address,
      100,
      '100000000000000000', // _deposit for claim : 0.1eth => 10% of amount
      '864000', // _timeoutPayment => 10 days
      '259200', // _challengePeriod => 3 days
      '', // _metaEvidence
    );

    expect(await erc20Mock.balanceOf(featureERC20.address)).to.equal(100);
    expect((await featureERC20.transactions(0)).sender).to.equal(
      sender.address,
    );
    expect((await featureERC20.transactions(0)).delayClaim).to.equal('259200');

    const claimTx = await contractAsSignerReceiver.claim(
      0, // _transactionID
      {
        value: '120000000000000000', // 0.12eth
        gasPrice: 150000000000,
      },
    );

    // Wait until the transaction is mined
    const transactionMinedClaimTx = await claimTx.wait();

    expect((await featureERC20.transactions(0)).runningClaimCount).to.equal(1);

    const gasFeeClaimTx = transactionMinedClaimTx.gasUsed
      .valueOf()
      .mul(150000000000);

    expect((await featureERC20.claims(0)).transactionID).to.equal(0);

    await network.provider.send('evm_increaseTime', [259200]);
    await network.provider.send('evm_mine');

    const payTx = await contractAsSignerDeployer.pay(
      0, // _claimID
    );

    const newBalanceReceiverExpected = new ethers.BigNumber.from(
      '1000000000000000000000',
    ).sub(gasFeeClaimTx);

    expect((await provider.getBalance(receiver.address)).toString()).to.equal(
      newBalanceReceiverExpected.toString(),
    );
    expect((await erc20Mock.balanceOf(receiver.address)).toString()).to.equal(
      '100',
    );

    // Give back deployer unused ether
    await sender.sendTransaction({
      to: deployer.address,
      value: ethers.utils.parseEther('900'),
    });

    await receiver.sendTransaction({
      to: deployer.address,
      value: ethers.utils.parseEther('900'),
    });
  });

  it('Should refund the money to the sender after a timeout payment without any claim', async function () {
    const sender = await createSigner();
    const contractAsSenderERC20Deployer = erc20Mock.connect(sender);
    const contractAsSignerSender = featureERC20.connect(sender);

    const createTransferTx = await contractAsSignerERC20Deployer.transfer(
      sender.address,
      100,
    );

    const createAllowERC20Tx = await contractAsSenderERC20Deployer.approve(
      featureERC20.address,
      100,
    );

    const createTransactionTx = await contractAsSignerSender.createTransaction(
      arbitrator.address,
      0x00,
      erc20Mock.address,
      100,
      '100000000000000000', // _deposit for claim : 0.1eth => 10% of amount
      '864000', // _timeoutPayment => 10 days
      '259200', // _challengePeriod => 3 days
      '', // _metaEvidence
    );

    expect((await featureERC20.transactions(0)).sender).to.equal(
      sender.address,
    );

    // Wait until the transaction is mined
    const transactionMinedClaimTx = await createTransactionTx.wait();
    const gasFeeCreateTransactionTx = transactionMinedClaimTx.gasUsed
      .valueOf()
      .mul(150000000000);

    await network.provider.send('evm_increaseTime', [864000]);
    await network.provider.send('evm_mine');

    const withdrawTx = await contractAsSignerDeployer.refund(
      0, // _transactionID
    );

    expect((await erc20Mock.balanceOf(sender.address)).toString()).to.equal(
      '100',
    );

    // Give back deployer unused ether
    await sender.sendTransaction({
      to: deployer.address,
      value: ethers.utils.parseEther('900'),
    });
  });

  it('Should revert the refund to the sender if the timeout payment is not passed', async function () {
    const sender = await createSigner();
    const receiver = await createSigner();
    const contractAsSenderERC20Deployer = erc20Mock.connect(sender);
    const contractAsSignerSender = featureERC20.connect(sender);
    const contractAsSignerReceiver = featureERC20.connect(receiver);

    const createTransferTx = await contractAsSignerERC20Deployer.transfer(
      sender.address,
      100,
    );

    const createAllowERC20Tx = await contractAsSenderERC20Deployer.approve(
      featureERC20.address,
      100,
    );

    const createTransactionTx = await contractAsSignerSender.createTransaction(
      arbitrator.address,
      0x00,
      erc20Mock.address,
      100,
      '100000000000000000', // _deposit for claim : 0.1eth => 10% of amount
      '864000', // _timeoutPayment => 10 days
      '259200', // _challengePeriod => 3 days
      '', // _metaEvidence
    );

    expect((await featureERC20.transactions(0)).sender).to.equal(
      sender.address,
    );

    // Wait until the transaction is mined
    const transactionMinedClaimTx = await createTransactionTx.wait();
    const gasFeeCreateTransactionTx = transactionMinedClaimTx.gasUsed
      .valueOf()
      .mul(150000000000);

    const claimTx = await contractAsSignerReceiver.claim(
      0, // _transactionID
      {
        value: '120000000000000000', // 0.12eth
        gasPrice: 150000000000,
      },
    );

    await network.provider.send('evm_increaseTime', [42]);
    await network.provider.send('evm_mine');

    await expect(contractAsSignerDeployer.refund(0)).to.be.revertedWith(
      'The timeout payment should be passed.',
    );

    // Give back deployer unused ether
    await sender.sendTransaction({
      to: deployer.address,
      value: ethers.utils.parseEther('900'),
    });

    await receiver.sendTransaction({
      to: deployer.address,
      value: ethers.utils.parseEther('900'),
    });
  });

  it('Should revert the refund to the sender if there is any claim', async function () {
    const sender = await createSigner();
    const receiver = await createSigner();
    const contractAsSenderERC20Deployer = erc20Mock.connect(sender);
    const contractAsSignerSender = featureERC20.connect(sender);
    const contractAsSignerReceiver = featureERC20.connect(receiver);

    const createTransferTx = await contractAsSignerERC20Deployer.transfer(
      sender.address,
      100,
    );

    const createAllowERC20Tx = await contractAsSenderERC20Deployer.approve(
      featureERC20.address,
      100,
    );

    const createTransactionTx = await contractAsSignerSender.createTransaction(
      arbitrator.address,
      0x00,
      erc20Mock.address,
      100,
      '100000000000000000', // _deposit for claim : 0.1eth => 10% of amount
      '864000', // _timeoutPayment => 10 days
      '259200', // _challengePeriod => 3 days
      '', // _metaEvidence
    );

    expect((await featureERC20.transactions(0)).sender).to.equal(
      sender.address,
    );

    // Wait until the transaction is mined
    const transactionMinedClaimTx = await createTransactionTx.wait();
    const gasFeeCreateTransactionTx = transactionMinedClaimTx.gasUsed
      .valueOf()
      .mul(150000000000);

    const claimTx = await contractAsSignerReceiver.claim(
      0, // _transactionID
      {
        value: '120000000000000000', // 0.12eth
        gasPrice: 150000000000,
      },
    );

    await network.provider.send('evm_increaseTime', [864000]);
    await network.provider.send('evm_mine');

    await expect(contractAsSignerDeployer.refund(0)).to.be.revertedWith(
      'The transaction should not to have running claims.',
    );

    // Give back deployer unused ether
    await sender.sendTransaction({
      to: deployer.address,
      value: ethers.utils.parseEther('900'),
    });

    await receiver.sendTransaction({
      to: deployer.address,
      value: ethers.utils.parseEther('900'),
    });
  });

  it('Should give the arbitration fee and the total deposit to the challenger after a successful challenge', async function () {
    const sender = await createSigner();
    const receiver = await createSigner();
    const challenger = await createSigner();
    const contractAsSenderERC20Deployer = erc20Mock.connect(sender);
    const contractAsSignerSender = featureERC20.connect(sender);
    const contractAsSignerReceiver = featureERC20.connect(receiver);
    const contractAsSignerChallenger = featureERC20.connect(challenger);

    const createTransferTx = await contractAsSignerERC20Deployer.transfer(
      sender.address,
      100,
    );

    const createAllowERC20Tx = await contractAsSenderERC20Deployer.approve(
      featureERC20.address,
      100,
    );

    const createTransactionTx = await contractAsSignerSender.createTransaction(
      arbitrator.address,
      0x00,
      erc20Mock.address,
      100,
      '100000000000000000', // _deposit for claim : 0.1eth => 10% of amount
      '864000', // _timeoutPayment => 10 days
      '259200', // _challengePeriod => 3 days
      '', // _metaEvidence
    );

    expect((await featureERC20.transactions(0)).sender).to.equal(
      sender.address,
    );

    // Claim
    const claimTx = await contractAsSignerReceiver.claim(
      0, // _transactionID
      {
        value: '120000000000000000', // 0.12eth
        gasPrice: 150000000000,
      },
    );

    // Challenge claim
    const challengeClaimTx = await contractAsSignerChallenger.challengeClaim(
      0, // _claimID
      {
        value: '120000000000000000', // 0.12eth
        gasPrice: 150000000000,
      },
    );

    // Wait until the transaction is mined
    const transactionMinedChallengeClaimTx = await challengeClaimTx.wait();

    const gasFeeChallengeClaimTx = transactionMinedChallengeClaimTx.gasUsed
      .valueOf()
      .mul(150000000000);

    // Give ruling
    await contractAsSignerJuror.giveRuling(
      0, // _disputeID
      2, // Ruling for the challenger
    );

    await network.provider.send('evm_increaseTime', [42]);
    await network.provider.send('evm_mine');

    // Execute ruling
    await contractAsSignerJuror.giveRuling(
      0, // _disputeID
      2, // Ruling for the challenger
    );

    const claim = await featureERC20.claims(0);

    // Claim status switch to Resolved.
    expect(parseInt(claim.status)).to.equal(2);

    const newBalanceChallengerExpected = new ethers.BigNumber.from(
      '1000000000000000000000',
    )
      .sub(gasFeeChallengeClaimTx)
      .add('100000000000000000');

    expect((await provider.getBalance(challenger.address)).toString()).to.equal(
      newBalanceChallengerExpected.toString(),
    );

    // Give back deployer unused ether
    await sender.sendTransaction({
      to: deployer.address,
      value: ethers.utils.parseEther('900'),
    });

    await receiver.sendTransaction({
      to: deployer.address,
      value: ethers.utils.parseEther('900'),
    });

    await challenger.sendTransaction({
      to: deployer.address,
      value: ethers.utils.parseEther('900'),
    });
  });

  it('Should give the amount of the total deposit to the claimer after a aborted challenge', async function () {
    const sender = await createSigner();
    const receiver = await createSigner();
    const challenger = await createSigner();
    const contractAsSenderERC20Deployer = erc20Mock.connect(sender);
    const contractAsSignerSender = featureERC20.connect(sender);
    const contractAsSignerReceiver = featureERC20.connect(receiver);
    const contractAsSignerChallenger = featureERC20.connect(challenger);

    const createTransferTx = await contractAsSignerERC20Deployer.transfer(
      sender.address,
      100,
    );

    await createTransferTx.wait();

    const createAllowERC20Tx = await contractAsSenderERC20Deployer.approve(
      featureERC20.address,
      100,
    );

    await createAllowERC20Tx.wait();

    const createTransactionTx = await contractAsSignerSender.createTransaction(
      arbitrator.address,
      0x00,
      erc20Mock.address,
      100,
      '100000000000000000', // _deposit for claim : 0.1eth => 10% of amount
      '864000', // _timeoutPayment => 10 days
      '259200', // _challengePeriod => 3 days
      '', // _metaEvidence
    );

    // Claim
    const claimTx = await contractAsSignerReceiver.claim(
      0, // _transactionID
      {
        value: '120000000000000000', // 0.12eth
        gasPrice: 150000000000,
      },
    );

    // Wait until the transaction is mined
    const transactionMinedClaimTx = await claimTx.wait();

    const gasFeeClaimTx = transactionMinedClaimTx.gasUsed
      .valueOf()
      .mul(150000000000);

    // Challenge claim
    const challengeClaimTx = await contractAsSignerChallenger.challengeClaim(
      0, // _claimID
      {
        value: '120000000000000000', // 0.12eth
        gasPrice: 150000000000,
      },
    );

    // Give ruling
    await contractAsSignerJuror.giveRuling(
      0, // _disputeID
      1, // Ruling for the receiver
    );

    await network.provider.send('evm_increaseTime', [42]);
    await network.provider.send('evm_mine');

    // Execute ruling
    await contractAsSignerJuror.giveRuling(
      0, // _disputeID
      1, // Ruling for the receiver
    );

    const newBalanceReceiverExpected = new ethers.BigNumber.from(
      '1000000000000000000000',
    )
      .sub(gasFeeClaimTx)
      .sub('20000000000000000');

    expect((await provider.getBalance(receiver.address)).toString()).to.equal(
      newBalanceReceiverExpected.toString(),
    );

    // Give back deployer unused ether
    await sender.sendTransaction({
      to: deployer.address,
      value: ethers.utils.parseEther('900'),
    });

    await receiver.sendTransaction({
      to: deployer.address,
      value: ethers.utils.parseEther('900'),
    });

    await challenger.sendTransaction({
      to: deployer.address,
      value: ethers.utils.parseEther('900'),
    });
  });

  it('Should give the amount of the total deposit to the claimer after a successful appeal', async function () {
    const sender = await createSigner();
    const receiver = await createSigner();
    const challenger = await createSigner();
    const contractAsSenderERC20Deployer = erc20Mock.connect(sender);
    const contractAsSignerSender = featureERC20.connect(sender);
    const contractAsSignerReceiver = featureERC20.connect(receiver);
    const contractAsSignerChallenger = featureERC20.connect(challenger);

    const createTransferTx = await contractAsSignerERC20Deployer.transfer(
      sender.address,
      100,
    );

    await createTransferTx.wait();

    const createAllowERC20Tx = await contractAsSenderERC20Deployer.approve(
      featureERC20.address,
      100,
    );

    await createAllowERC20Tx.wait();

    const createTransactionTx = await contractAsSignerSender.createTransaction(
      arbitrator.address,
      0x00,
      erc20Mock.address,
      100,
      '100000000000000000', // _deposit for claim : 0.1eth => 10% of amount
      '864000', // _timeoutPayment => 10 days
      '259200', // _challengePeriod => 3 days
      '', // _metaEvidence
    );

    // Claim
    const claimTx = await contractAsSignerReceiver.claim(
      0, // _transactionID
      {
        value: '120000000000000000', // 0.12eth
        gasPrice: 150000000000,
      },
    );

    // Wait until the transaction is mined
    const transactionMinedClaimTx = await claimTx.wait();

    const gasFeeClaimTx = transactionMinedClaimTx.gasUsed
      .valueOf()
      .mul(150000000000);

    // Challenge claim
    const challengeClaimTx = await contractAsSignerChallenger.challengeClaim(
      0, // _claimID
      {
        value: '120000000000000000', // 0.12eth
        gasPrice: 150000000000,
      },
    );

    await challengeClaimTx.wait();

    // Give ruling
    const giveRulingTx = await contractAsSignerJuror.giveRuling(
      0, // _disputeID
      2, // Ruling for the challenger
    );

    // Appeal
    const appealTx = await contractAsSignerReceiver.appeal(
      0, // _claimID
      {
        value: '20000000000000000', // 0.2eth
        gasPrice: 150000000000,
      },
    );

    expect((await contractAsSignerJuror.disputes(0)).status).to.equal(1);
    expect((await contractAsSignerJuror.disputes(0)).isAppealed).to.true;

    // Wait until the transaction is mined
    const transactionMinedAppealTx = await appealTx.wait();

    const gasFeeAppealTx = transactionMinedAppealTx.gasUsed
      .valueOf()
      .mul(150000000000);

    await network.provider.send('evm_increaseTime', [42]);
    await network.provider.send('evm_mine'); // this one will have 100s more

    // Execute ruling
    await contractAsSignerJuror.giveRuling(
      0, // _disputeID
      1, // Ruling for the receiver
    );

    expect((await contractAsSignerJuror.disputes(0)).status).to.equal(2);
    expect((await contractAsSignerJuror.disputes(0)).ruling).to.equal(1);

    const newBalanceReceiverExpected = new ethers.BigNumber.from(
      '1000000000000000000000',
    )
      .sub(gasFeeClaimTx)
      .sub(gasFeeAppealTx)
      .sub('40000000000000000');

    expect((await provider.getBalance(receiver.address)).toString()).to.equal(
      newBalanceReceiverExpected.toString(),
    );

    // Give back deployer unused ether
    await sender.sendTransaction({
      to: deployer.address,
      value: ethers.utils.parseEther('900'),
    });

    await receiver.sendTransaction({
      to: deployer.address,
      value: ethers.utils.parseEther('900'),
    });

    await challenger.sendTransaction({
      to: deployer.address,
      value: ethers.utils.parseEther('900'),
    });
  });

  // Scenario: 2 claimers, the first one get the reward.
  it('Should give the amount of the first claimer who claim in multiple successful claims', async function () {
    const sender = await createSigner();
    const receiver1 = await createSigner();
    const receiver2 = await createSigner();
    const contractAsSenderERC20Deployer = erc20Mock.connect(sender);
    const contractAsSignerSender = featureERC20.connect(sender);
    const contractAsSignerReceiver1 = featureERC20.connect(receiver1);
    const contractAsSignerReceiver2 = featureERC20.connect(receiver2);

    const createTransferTx = await contractAsSignerERC20Deployer.transfer(
      sender.address,
      100,
    );

    await createTransferTx.wait();

    const createAllowERC20Tx = await contractAsSenderERC20Deployer.approve(
      featureERC20.address,
      100,
    );

    await createAllowERC20Tx.wait();

    const createTransactionTx = await contractAsSignerSender.createTransaction(
      arbitrator.address,
      0x00,
      erc20Mock.address,
      100,
      '100000000000000000', // _deposit for claim : 0.1eth => 10% of amount
      '864000', // _timeoutPayment => 10 days
      '259200', // _challengePeriod => 3 days
      '', // _metaEvidence
    );

    // 1st claim
    const claimTx1 = await contractAsSignerReceiver1.claim(
      0, // _transactionID
      {
        value: '120000000000000000', // 0.12eth
        gasPrice: 150000000000,
      },
    );

    // Wait until the transaction is mined
    const transactionMinedClaimTx1 = await claimTx1.wait();
    const gasFeeClaimTx1 = transactionMinedClaimTx1.gasUsed
      .valueOf()
      .mul(150000000000);

    // 2nd claim
    const claimTx2 = await contractAsSignerReceiver2.claim(
      0, // _transactionID
      {
        value: '120000000000000000', // 0.12eth
        gasPrice: 150000000000,
      },
    );

    // Wait until the transaction is mined
    const transactionMinedClaimTx2 = await claimTx2.wait();
    const gasFeeClaimTx2 = transactionMinedClaimTx2.gasUsed
      .valueOf()
      .mul(150000000000);

    // Wait until the challenge period is over
    await network.provider.send('evm_increaseTime', [259200]);
    await network.provider.send('evm_mine');

    // Pay the first claimer
    const payTx = await contractAsSignerDeployer.pay(
      0, // _claimID
    );

    const newBalanceReceiver1Expected = new ethers.BigNumber.from(
      '1000000000000000000000',
    ).sub(gasFeeClaimTx1);

    const newBalanceReceiver2Expected = new ethers.BigNumber.from(
      '1000000000000000000000',
    )
      .sub(gasFeeClaimTx2)
      .sub(ethers.BigNumber.from('120000000000000000')); // Claim value

    // First claimer should receive the payment
    expect((await provider.getBalance(receiver1.address)).toString()).to.equal(
      newBalanceReceiver1Expected.toString(),
    );

    // Second claimer must not receive the payment
    expect((await provider.getBalance(receiver2.address)).toString()).to.equal(
      newBalanceReceiver2Expected.toString(),
    );

    // Give back deployer unused ether
    await sender.sendTransaction({
      to: deployer.address,
      value: ethers.utils.parseEther('900'),
    });

    await receiver1.sendTransaction({
      to: deployer.address,
      value: ethers.utils.parseEther('900'),
    });

    await receiver2.sendTransaction({
      to: deployer.address,
      value: ethers.utils.parseEther('900'),
    });
  });
});
