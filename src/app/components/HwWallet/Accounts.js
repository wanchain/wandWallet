import React, { Component } from 'react';
import { Table, message, Row, Col } from 'antd';
import { observer, inject } from 'mobx-react';
import intl from 'react-intl-universal';
import { formatNum } from 'utils/support';
import { hasSameName } from 'utils/helper';
import TransHistory from 'components/TransHistory';
import ETHTransHistory from 'components/TransHistory/ETHTransHistory';
import CopyAndQrcode from 'components/CopyAndQrcode';
import SendNormalTrans from 'components/SendNormalTrans';
import SendETHNormalTrans from 'components/SendNormalTrans/SendETHNormalTrans';
import { EditableFormRow, EditableCell } from 'components/Rename';
import { ETHCHAINID } from 'utils/settings';
import style from './index.less';

const CHAIN_TYPE = 'WAN';

@inject(stores => ({
  rawTx: stores.sendTransParams.rawTx,
  addrWANInfo: stores.wanAddress.addrInfo,
  addrETHInfo: stores.ethAddress.addrInfo,
  language: stores.languageIntl.language,
  transParams: stores.sendTransParams.transParams,
  network: stores.session.chainId === 1 ? 'main' : 'testnet',
  updateWANName: (obj, type) => stores.wanAddress.updateName(obj, type),
  updateETHName: (obj, type) => stores.ethAddress.updateName(obj, type),
  updateWANTransHistory: () => stores.wanAddress.updateTransHistory(),
  updateETHTransHistory: () => stores.ethAddress.updateTransHistory(),
}))

@observer
class Accounts extends Component {
  constructor(props) {
    super(props);
    this.chain = props.chainType || CHAIN_TYPE;
    this.isWAN = this.chain === CHAIN_TYPE;
  }

  columns = [
    {
      dataIndex: 'name',
      editable: true
    },
    {
      dataIndex: 'address',
      render: text => <div className="addrText"><p className="address">{text}</p><CopyAndQrcode addr={text} /></div>
    },
    {
      dataIndex: 'balance',
      render: balance => <span>{formatNum(balance)}</span>
    },
    {
      dataIndex: 'action',
      render: (text, record) => {
        return (
          <div>{this.props.chainType === CHAIN_TYPE ? <SendNormalTrans path={record.path} from={record.address} balance={record.balance} handleSend={this.handleSend} chainType={this.props.chainType} disablePrivateTx={true} /> : <SendETHNormalTrans path={record.path} from={record.address} balance={record.balance} handleSend={this.handleSend} chainType={this.props.chainType} disablePrivateTx={true} />}</div>
        )
      }
    }
  ];

  columnsTree = this.columns.map(col => {
    if (!col.editable) {
      return col;
    }
    return {
      ...col,
      onCell: record => ({
        record,
        editable: col.editable,
        dataIndex: col.dataIndex,
        title: col.title,
        handleSave: this.handleSave,
      }),
    };
  });

  handleSave = row => {
    let type = this.props.name[0];
    if (hasSameName(type, row, this.props[this.isWAN ? 'addrWANInfo' : 'addrETHInfo'])) {
      message.warn(intl.get('WanAccount.notSameName'));
    } else {
      this.props[this.isWAN ? 'updateWANName' : 'updateETHName'](row, row.wid);
    }
  }

  handleSend = from => {
    const { rawTx, chainType, network } = this.props;
    let params = this.props.transParams[from];
    if (chainType === 'ETH') {
      rawTx.chainId = network === 'main' ? ETHCHAINID.MAIN : ETHCHAINID.TEST;
    }
    return new Promise((resolve, reject) => {
      this.props.signTransaction(params.path, rawTx, (_err, raw) => {
        if (_err !== null) {
          reject(_err);
          return;
        }
        wand.request('transaction_raw', { raw, chainType }, (err, txHash) => {
          console.log('txHash:', txHash);
          if (err) {
            message.warn(intl.get('HwWallet.Accounts.sendTransactionFailed'));
            console.log('error:', err);
            reject(err);
          } else {
            let params = {
              txHash,
              from: from.toLowerCase(),
              srcSCAddrKey: chainType,
              srcChainType: chainType,
              tokenSymbol: chainType,
              ...rawTx
            }
            wand.request('transaction_insertTransToDB', { rawTx: params }, () => {
              this.props[this.isWAN ? 'updateWANTransHistory' : 'updateETHTransHistory']();
            })
            resolve();
          }
        });
      });
    })
  }

  render() {
    const { name, addresses } = this.props;
    const components = {
      body: {
        cell: EditableCell,
        row: EditableFormRow,
      },
    };

    this.props.language && this.columnsTree.forEach(col => {
      col.title = intl.get(`HwWallet.Accounts.${col.dataIndex}`)
    })
    return (
      <div className="account">
        <Row className="mainBody">
          <Col>
            <Table components={components} rowClassName={() => 'editable-row'} pagination={false} columns={this.columnsTree} dataSource={addresses}></Table>
          </Col>
        </Row>
        <Row className="mainBody">
          <Col>
            {this.isWAN ? <TransHistory name={name} /> : <ETHTransHistory name={name} />}
          </Col>
        </Row>
      </div>
    )
  }
}

export default Accounts;
